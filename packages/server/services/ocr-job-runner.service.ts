import { join } from "node:path";
import { getDatabase } from "../database/client";
import { createId } from "../utils/identifier";
import { getAppConfig } from "../utils/runtime-config";
import { writeLog } from "../utils/logger";
import { ocrProcessManager } from "./ocr-process.service";
import { parseOcrLines, type OcrLine } from "./ocr-rule-parser";
import { enqueueAiExtraction } from "./ai-job-runner.service";

type ClaimedJob = {
  id: string;
  intakeId: string;
  imageId: string;
  imageRole: string;
  storagePath: string;
  attempts: number;
  fieldsJson: string;
};

class OcrJobRunner {
  private started = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private working = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.schedule(100);
  }

  private schedule(delay = getAppConfig().ocrPollIntervalMs) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private recoverExpiredJobs() {
    const db = getDatabase();
    db.prepare(`
      UPDATE processing_jobs
      SET
        status = 'queued',
        stage = 'recovered',
        locked_at = NULL,
        lease_expires_at = NULL,
        next_retry_at = CURRENT_TIMESTAMP,
        error_code = 'LEASE_EXPIRED',
        error_message = '任务进程中断，已自动恢复'
      WHERE status = 'processing'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at <= CURRENT_TIMESTAMP
    `).run();
  }

  private hasEligibleJob() {
    return Boolean(getDatabase().prepare(`
      SELECT 1
      FROM processing_jobs
      WHERE status = 'queued'
        AND job_type = 'ocr'
        AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      LIMIT 1
    `).get());
  }

  private markWaitingRuntime(errorCode: string | null, errorMessage: string | null) {
    const db = getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE processing_jobs
        SET stage = 'waiting_runtime', error_code = ?, error_message = ?
        WHERE status = 'queued'
          AND job_type = 'ocr'
          AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
      `).run(errorCode, errorMessage);
      db.prepare(`
        UPDATE intake_drafts
        SET status = 'queued', processing_stage = 'waiting_runtime', updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT DISTINCT intake_id
          FROM processing_jobs
          WHERE status = 'queued' AND stage = 'waiting_runtime'
        )
      `).run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private claimJob() {
    const db = getDatabase();
    db.exec("BEGIN IMMEDIATE");
    try {
      const job = db.prepare(`
        SELECT
          j.id,
          j.intake_id AS intakeId,
          j.image_id AS imageId,
          m.image_role AS imageRole,
          m.storage_path AS storagePath,
          j.attempts,
          c.fields_json AS fieldsJson
        FROM processing_jobs j
        JOIN media_assets m ON m.id = j.image_id
        JOIN intake_drafts d ON d.id = j.intake_id
        LEFT JOIN category_templates c ON c.id = d.category_id
        WHERE j.status = 'queued'
          AND j.job_type = 'ocr'
          AND (j.next_retry_at IS NULL OR j.next_retry_at <= CURRENT_TIMESTAMP)
        ORDER BY j.created_at
        LIMIT 1
      `).get() as ClaimedJob | undefined;

      if (!job) {
        db.exec("COMMIT");
        return null;
      }
      db.prepare(`
        UPDATE processing_jobs
        SET
          status = 'processing',
          stage = 'ocr_processing',
          attempts = attempts + 1,
          locked_at = CURRENT_TIMESTAMP,
          lease_expires_at = datetime('now', '+5 minutes'),
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
          error_code = NULL,
          error_message = NULL
        WHERE id = ?
      `).run(job.id);
      db.prepare(`
        UPDATE intake_drafts
        SET status = 'ocr_processing', processing_stage = 'ocr_processing', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(job.intakeId);
      db.exec("COMMIT");
      return { ...job, attempts: Number(job.attempts) + 1 };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private completeJob(job: ClaimedJob, result: Awaited<ReturnType<typeof ocrProcessManager.recognize>>) {
    const db = getDatabase();
    const lines = (result.lines || []) as OcrLine[];
    const categoryFields = JSON.parse(job.fieldsJson || "{}") as { expirationEnabled?: boolean };
    const candidates = parseOcrLines(job.imageId, lines, {
      expirationEnabled: categoryFields.expirationEnabled,
      imageRole: job.imageRole
    });

    let pipelineFinished = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        INSERT INTO ocr_results (
          id, job_id, image_id, engine, model_version, lines_json, elapsed_ms, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          engine = excluded.engine,
          model_version = excluded.model_version,
          lines_json = excluded.lines_json,
          elapsed_ms = excluded.elapsed_ms,
          raw_json = excluded.raw_json,
          created_at = CURRENT_TIMESTAMP
      `).run(
        createId("ocr"),
        job.id,
        job.imageId,
        result.engine || "rapidocr-openvino",
        result.modelVersion || "PP-OCRv4-mobile",
        JSON.stringify(lines),
        result.elapsedMs ?? null,
        JSON.stringify({ engineElapsed: result.engineElapsed ?? null })
      );
      db.prepare(`
        DELETE FROM field_candidates
        WHERE intake_id = ?
          AND source IN ('ocr_rule', 'computed')
          AND json_extract(evidence_json, '$.imageId') = ?
      `).run(job.intakeId, job.imageId);
      for (const item of candidates) {
        db.prepare(`
          INSERT INTO field_candidates (
            id, intake_id, field_key, value_json, source, confidence, evidence_json, based_on_version
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, (
            SELECT version FROM intake_drafts WHERE id = ?
          ))
        `).run(
          createId("candidate"),
          job.intakeId,
          item.fieldKey,
          JSON.stringify(item.value),
          item.fieldKey === "expirationDate" && item.evidence.lineIds.length > 1 ? "computed" : "ocr_rule",
          item.confidence,
          JSON.stringify(item.evidence),
          job.intakeId
        );
      }
      db.prepare(`
        UPDATE processing_jobs
        SET
          status = 'completed',
          stage = 'completed',
          locked_at = NULL,
          lease_expires_at = NULL,
          next_retry_at = NULL,
          error_code = NULL,
          error_message = NULL,
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(job.id);
      const remaining = db.prepare(`
        SELECT
          SUM(CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeCount,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount
        FROM processing_jobs
        WHERE intake_id = ?
      `).get(job.intakeId) as { activeCount: number | null; failedCount: number | null };
      if (Number(remaining.activeCount || 0) === 0) {
        pipelineFinished = true;
        db.prepare(`
          UPDATE intake_drafts
          SET
            status = 'queued',
            processing_stage = 'rule_parsing',
            review_required = 0,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.intakeId);
      } else {
        db.prepare(`
          UPDATE intake_drafts
          SET status = 'queued', processing_stage = 'queued', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(job.intakeId);
      }
      db.exec("COMMIT");
      if (pipelineFinished) enqueueAiExtraction(job.intakeId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private failJob(job: ClaimedJob, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const retry = job.attempts < 3;
    const delaySeconds = Math.min(60, 2 ** job.attempts * 5);
    const db = getDatabase();
    let pipelineFinished = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE processing_jobs
        SET
          status = ?,
          stage = ?,
          locked_at = NULL,
          lease_expires_at = NULL,
          next_retry_at = CASE WHEN ? THEN datetime('now', ?) ELSE NULL END,
          error_code = 'OCR_PROCESSING_FAILED',
          error_message = ?,
          finished_at = CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END
        WHERE id = ?
      `).run(
        retry ? "queued" : "failed",
        retry ? "retry_wait" : "failed",
        retry ? 1 : 0,
        `+${delaySeconds} seconds`,
        message.slice(0, 1000),
        retry ? 1 : 0,
        job.id
      );
      if (!retry) {
        const active = db.prepare(`
          SELECT COUNT(*) AS count FROM processing_jobs
          WHERE intake_id = ? AND job_type = 'ocr' AND status IN ('queued', 'processing')
        `).get(job.intakeId) as { count: number };
        pipelineFinished = Number(active.count) === 0;
      }
      db.prepare(`
        UPDATE intake_drafts
        SET status = ?, processing_stage = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        pipelineFinished ? "queued" : retry ? "queued" : "failed",
        pipelineFinished ? "rule_parsing" : retry ? "retry_wait" : "failed",
        job.intakeId
      );
      db.exec("COMMIT");
      if (pipelineFinished) enqueueAiExtraction(job.intakeId);
    } catch (databaseError) {
      db.exec("ROLLBACK");
      throw databaseError;
    }
  }

  private async tick() {
    if (this.working || this.stopped) {
      this.schedule();
      return;
    }
    this.working = true;
    try {
      this.recoverExpiredJobs();
      if (!this.hasEligibleJob()) return;

      const runtime = await ocrProcessManager.checkRuntime();
      if (!runtime.ready) {
        this.markWaitingRuntime(runtime.errorCode, runtime.errorMessage);
        return;
      }
      const job = this.claimJob();
      if (!job) return;

      try {
        const imagePath = join(getAppConfig().storageDir, "images", job.storagePath);
        const result = await ocrProcessManager.recognize(job.id, imagePath, job.imageRole);
        if (!result.ok) {
          throw new Error(result.errorMessage || "OCR 识别失败");
        }
        this.completeJob(job, result);
      } catch (error) {
        this.failJob(job, error);
        await writeLog("error", "OCR job failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } catch (error) {
      await writeLog("error", "OCR runner tick failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.working = false;
      this.schedule();
    }
  }

  getStatus() {
    const db = getDatabase();
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM processing_jobs
      WHERE job_type = 'ocr'
    `).get() as { queued: number | null; processing: number | null; failed: number | null };
    return {
      worker: ocrProcessManager.getStatus(),
      queue: {
        queued: Number(counts.queued || 0),
        processing: Number(counts.processing || 0),
        failed: Number(counts.failed || 0),
        runnerStarted: this.started && !this.stopped
      }
    };
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    ocrProcessManager.stop();
  }
}

export const ocrJobRunner = new OcrJobRunner();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    ocrJobRunner.stop();
    process.exit(0);
  });
}
