import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { createError } from "h3";
import { Jimp, JimpMime } from "jimp";
import { getDatabase } from "../database/client";
import { requireFamilyAccess } from "../utils/access-control";
import { createId } from "../utils/identifier";
import type { RequestUser } from "../utils/request-user";
import { getAppConfig } from "../utils/runtime-config";
import { enqueueAiReExtraction } from "./ai-job-runner.service";
import { createManualStockIn, parseManualStockInInput } from "./inventory.service";

const allowedImageRoles = new Set(["product", "label", "date"]);
const allowedMimeTypes: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};
const maxImageBytes = 12 * 1024 * 1024;
const maxThumbnailBytes = 512 * 1024;
const pipelineVersion = "ocr-v1";

type IntakeImageThumbnail = {
  mimeType: string;
  data: Buffer;
};

type DraftRow = {
  id: string;
  version: number;
  familyId: string;
  locationId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: string;
  processingStage: string | null;
  userValuesJson: string;
  reviewRequired: number;
  createdAt: string;
  updatedAt: string;
};

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function requireDraft(user: RequestUser, intakeId: string) {
  const row = getDatabase().prepare(`
    SELECT
      d.id,
      d.version,
      d.family_id AS familyId,
      d.location_id AS locationId,
      d.category_id AS categoryId,
      c.name AS categoryName,
      d.status,
      d.processing_stage AS processingStage,
      d.user_values_json AS userValuesJson,
      d.review_required AS reviewRequired,
      d.created_at AS createdAt,
      d.updated_at AS updatedAt
    FROM intake_drafts d
    JOIN family_members fm
      ON fm.family_id = d.family_id AND fm.user_id = ?
    LEFT JOIN category_templates c ON c.id = d.category_id
    WHERE d.id = ?
  `).get(user.id, intakeId) as DraftRow | undefined;

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "录入草稿不存在" });
  }
  return row;
}

function mapDraft(row: DraftRow) {
  return {
    id: row.id,
    version: row.version,
    familyId: row.familyId,
    locationId: row.locationId,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    status: row.status,
    processingStage: row.processingStage,
    userValues: parseJson<Record<string, unknown>>(row.userValuesJson, {}),
    reviewRequired: Boolean(row.reviewRequired),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function getProductCoverImageId(intakeId: string) {
  const row = getDatabase().prepare(`
    SELECT id
    FROM media_assets
    WHERE intake_id = ? AND image_role = 'product'
    ORDER BY created_at
    LIMIT 1
  `).get(intakeId) as { id: string } | undefined;
  return row?.id || null;
}

export function createIntakeDraft(user: RequestUser, body: Record<string, unknown>) {
  const familyId = optionalText(body.familyId);
  const locationId = optionalText(body.locationId);
  const categoryId = optionalText(body.categoryId);
  const userValues =
    body.userValues && typeof body.userValues === "object" && !Array.isArray(body.userValues)
      ? body.userValues
      : {};

  if (!familyId) {
    throw createError({
      statusCode: 400,
      statusMessage: "家庭不能为空"
    });
  }
  if (JSON.stringify(userValues).length > 20_000) {
    throw createError({ statusCode: 400, statusMessage: "草稿字段内容过大" });
  }

  requireFamilyAccess(user, familyId);
  const db = getDatabase();
  if (locationId) {
    const location = db.prepare("SELECT 1 FROM locations WHERE id = ? AND family_id = ?").get(locationId, familyId);
    if (!location) {
      throw createError({ statusCode: 404, statusMessage: "地点不存在" });
    }
  }
  if (categoryId) {
    const category = db.prepare("SELECT 1 FROM category_templates WHERE id = ?").get(categoryId);
    if (!category) {
      throw createError({ statusCode: 404, statusMessage: "品类不存在" });
    }
  }

  const intakeId = createId("intake");
  const initialFieldVersions = Object.fromEntries(
    Object.keys({ ...userValues, ...(locationId ? { locationId } : {}), ...(categoryId ? { categoryId } : {}) })
      .map((key) => [key, 1])
  );
  db.prepare(`
    INSERT INTO intake_drafts (
      id, family_id, created_by, location_id, category_id, user_values_json, field_versions_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(intakeId, familyId, user.id, locationId, categoryId, JSON.stringify(userValues), JSON.stringify(initialFieldVersions));

  return getIntakeDetail(user, intakeId);
}

export function listIntakeDrafts(user: RequestUser, familyId: string) {
  requireFamilyAccess(user, familyId);
  const rows = getDatabase().prepare(`
    SELECT
      d.id,
      d.version,
      d.family_id AS familyId,
      d.location_id AS locationId,
      d.category_id AS categoryId,
      c.name AS categoryName,
      d.status,
      d.processing_stage AS processingStage,
      d.user_values_json AS userValuesJson,
      d.review_required AS reviewRequired,
      d.created_at AS createdAt,
      d.updated_at AS updatedAt
    FROM intake_drafts d
    LEFT JOIN category_templates c ON c.id = d.category_id
    WHERE d.family_id = ?
      AND d.status != 'cancelled'
    ORDER BY
      CASE WHEN d.status IN ('needs_review', 'failed') THEN 0 ELSE 1 END,
      d.updated_at DESC
    LIMIT 30
  `).all(familyId) as DraftRow[];

  return rows.map((row) => {
    const counts = getDatabase().prepare(`
      SELECT
        COUNT(*) AS imageCount,
        SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) AS completedJobCount,
        SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failedJobCount
      FROM media_assets m
      LEFT JOIN processing_jobs j ON j.image_id = m.id
      WHERE m.intake_id = ?
    `).get(row.id) as { imageCount: number; completedJobCount: number | null; failedJobCount: number | null };
    return {
      ...mapDraft(row),
      imageCount: Number(counts.imageCount),
      completedJobCount: Number(counts.completedJobCount || 0),
      failedJobCount: Number(counts.failedJobCount || 0)
    };
  });
}

export function getIntakeDetail(user: RequestUser, intakeId: string) {
  const draft = requireDraft(user, intakeId);
  const db = getDatabase();
  const media = db.prepare(`
    SELECT
      id,
      image_role AS imageRole,
      mime_type AS mimeType,
      file_size AS fileSize,
      sha256,
      width,
      height,
      created_at AS createdAt
    FROM media_assets
    WHERE intake_id = ?
    ORDER BY CASE image_role WHEN 'product' THEN 1 WHEN 'label' THEN 2 ELSE 3 END
  `).all(intakeId) as Array<Record<string, unknown>>;
  const jobs = db.prepare(`
    SELECT
      id,
      image_id AS imageId,
      job_type AS jobType,
      status,
      stage,
      attempts,
      error_code AS errorCode,
      error_message AS errorMessage,
      created_at AS createdAt,
      started_at AS startedAt,
      finished_at AS finishedAt
    FROM processing_jobs
    WHERE intake_id = ?
    ORDER BY created_at
  `).all(intakeId) as Array<Record<string, unknown>>;
  const ocrResults = db.prepare(`
    SELECT
      r.id,
      r.job_id AS jobId,
      r.image_id AS imageId,
      r.engine,
      r.model_version AS modelVersion,
      r.lines_json AS linesJson,
      r.elapsed_ms AS elapsedMs,
      r.created_at AS createdAt
    FROM ocr_results r
    JOIN processing_jobs j ON j.id = r.job_id
    WHERE j.intake_id = ?
    ORDER BY r.created_at
  `).all(intakeId) as Array<Record<string, unknown> & { linesJson: string }>;
  const candidates = db.prepare(`
    SELECT
      id,
      field_key AS fieldKey,
      value_json AS valueJson,
      source,
      confidence,
      evidence_json AS evidenceJson,
      based_on_version AS basedOnVersion,
      accepted_at AS acceptedAt,
      rejected_at AS rejectedAt,
      created_at AS createdAt
    FROM field_candidates
    WHERE intake_id = ?
    ORDER BY field_key,
      CASE source WHEN 'barcode' THEN 1 WHEN 'ocr_rule' THEN 2 WHEN 'computed' THEN 3 ELSE 4 END,
      confidence DESC, created_at DESC
  `).all(intakeId) as Array<Record<string, unknown> & { valueJson: string; evidenceJson: string }>;

  const gatewayPrefix = getAppConfig().gatewayPrefix.replace(/\/$/, "");

  return {
    ...mapDraft(draft),
    media: media.map((item) => ({
      ...item,
      url: `${gatewayPrefix}/api/media/${item.id}`
    })),
    jobs,
    ocrResults: ocrResults.map(({ linesJson, ...item }) => ({
      ...item,
      lines: parseJson(linesJson, [])
    })),
    candidates: candidates.map(({ valueJson, evidenceJson, ...item }) => ({
      ...item,
      value: parseJson(valueJson, null),
      evidence: parseJson(evidenceJson, {})
    }))
  };
}

export function updateIntakeDraft(user: RequestUser, intakeId: string, body: Record<string, unknown>) {
  const draft = requireDraft(user, intakeId);
  if (["completed", "cancelled"].includes(draft.status)) {
    throw createError({ statusCode: 409, statusMessage: "该草稿不能继续修改" });
  }
  const submittedValues =
    body.values && typeof body.values === "object" && !Array.isArray(body.values)
      ? body.values as Record<string, unknown>
      : {};
  const previousValues = parseJson<Record<string, unknown>>(draft.userValuesJson, {});
  const values = {
    ...previousValues,
    ...submittedValues
  };
  if (JSON.stringify(values).length > 20_000) {
    throw createError({ statusCode: 400, statusMessage: "草稿字段内容过大" });
  }

  const locationId = optionalText(values.locationId);
  const categoryId = optionalText(values.categoryId);
  const db = getDatabase();
  if (locationId) {
    const location = db.prepare("SELECT 1 FROM locations WHERE id = ? AND family_id = ?").get(locationId, draft.familyId);
    if (!location) throw createError({ statusCode: 404, statusMessage: "地点不存在" });
  }
  if (categoryId && !db.prepare("SELECT 1 FROM category_templates WHERE id = ?").get(categoryId)) {
    throw createError({ statusCode: 404, statusMessage: "品类不存在" });
  }
  const versionRow = db.prepare("SELECT field_versions_json AS fieldVersionsJson FROM intake_drafts WHERE id = ?")
    .get(intakeId) as { fieldVersionsJson: string };
  const fieldVersions = parseJson<Record<string, number>>(versionRow.fieldVersionsJson, {});
  const nextVersion = draft.version + 1;
  for (const [key, value] of Object.entries(submittedValues)) {
    if (JSON.stringify(previousValues[key]) !== JSON.stringify(value)) fieldVersions[key] = nextVersion;
  }

  db.prepare(`
    UPDATE intake_drafts
    SET
      location_id = ?,
      category_id = ?,
      user_values_json = ?,
      field_versions_json = ?,
      version = version + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(locationId, categoryId, JSON.stringify(values), JSON.stringify(fieldVersions), intakeId);
  return getIntakeDetail(user, intakeId);
}

export async function saveIntakeImage(input: {
  user: RequestUser;
  intakeId: string;
  imageRole: string;
  mimeType: string;
  data: Buffer;
  thumbnail?: IntakeImageThumbnail;
}) {
  const draft = requireDraft(input.user, input.intakeId);
  if (["completed", "cancelled"].includes(draft.status)) {
    throw createError({ statusCode: 409, statusMessage: "该草稿不能继续上传图片" });
  }
  if (!allowedImageRoles.has(input.imageRole)) {
    throw createError({ statusCode: 400, statusMessage: "图片类型无效" });
  }
  const extension = allowedMimeTypes[input.mimeType];
  if (!extension) {
    throw createError({ statusCode: 415, statusMessage: "仅支持 JPEG、PNG 和 WebP 图片" });
  }
  if (!input.data.length || input.data.length > maxImageBytes) {
    throw createError({ statusCode: 413, statusMessage: "图片大小必须在 12 MB 以内" });
  }

  const config = getAppConfig();
  const intakeDirectory = join(config.storageDir, "images", input.intakeId);
  await mkdir(intakeDirectory, { recursive: true });
  const imageId = createId("media");
  const filename = `${imageId}${extension}`;
  const relativePath = join(input.intakeId, filename);
  const finalPath = join(config.storageDir, "images", relativePath);
  const temporaryPath = `${finalPath}.uploading`;
  const thumbnailExtension = input.thumbnail ? allowedMimeTypes[input.thumbnail.mimeType] : null;
  const shouldSaveThumbnail = Boolean(
    input.thumbnail &&
    thumbnailExtension &&
    input.thumbnail.data.length > 0 &&
    input.thumbnail.data.length <= maxThumbnailBytes
  );
  const thumbnailRelativePath = shouldSaveThumbnail ? join(input.intakeId, `${imageId}-thumb${thumbnailExtension}`) : null;
  const thumbnailFinalPath = thumbnailRelativePath ? join(config.storageDir, "images", thumbnailRelativePath) : null;
  const thumbnailTemporaryPath = thumbnailFinalPath ? `${thumbnailFinalPath}.uploading` : null;
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  await writeFile(temporaryPath, input.data, { flag: "wx" });
  await rename(temporaryPath, finalPath);
  if (input.thumbnail && thumbnailFinalPath && thumbnailTemporaryPath) {
    await writeFile(thumbnailTemporaryPath, input.thumbnail.data, { flag: "wx" });
    await rename(thumbnailTemporaryPath, thumbnailFinalPath);
  }

  const db = getDatabase();
  const previous = db.prepare(`
    SELECT id, storage_path AS storagePath, thumbnail_path AS thumbnailPath
    FROM media_assets
    WHERE intake_id = ? AND image_role = ?
  `).get(input.intakeId, input.imageRole) as { id: string; storagePath: string; thumbnailPath: string | null } | undefined;
  const jobId = createId("job");
  const deduplicationKey = `${input.intakeId}:${input.imageRole}:${sha256}:${pipelineVersion}`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'superseded', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND job_type = 'ai' AND status IN ('queued', 'failed')
    `).run(input.intakeId);
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND status IN ('queued', 'failed')
    `).run(input.intakeId);
    db.prepare(`
      DELETE FROM field_candidates
      WHERE intake_id = ? AND source = 'ai' AND accepted_at IS NULL
    `).run(input.intakeId);
    if (previous) {
      db.prepare("DELETE FROM media_assets WHERE id = ?").run(previous.id);
    }
    db.prepare(`
      INSERT INTO media_assets (
        id, intake_id, image_role, storage_path, thumbnail_path, mime_type, file_size, sha256
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      imageId,
      input.intakeId,
      input.imageRole,
      relativePath,
      thumbnailRelativePath,
      input.mimeType,
      input.data.length,
      sha256
    );
    db.prepare(`
      INSERT INTO processing_jobs (
        id, intake_id, image_id, job_type, status, stage, pipeline_version, deduplication_key
      )
      VALUES (?, ?, ?, 'ocr', 'queued', 'queued', ?, ?)
    `).run(jobId, input.intakeId, imageId, pipelineVersion, deduplicationKey);
    db.prepare(`
      UPDATE intake_drafts
      SET
        status = 'queued',
        processing_stage = 'queued',
        review_required = 0,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.intakeId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    await unlink(finalPath).catch(() => undefined);
    if (thumbnailFinalPath) {
      await unlink(thumbnailFinalPath).catch(() => undefined);
    }
    throw error;
  }

  if (previous) {
    const previousPath = join(config.storageDir, "images", previous.storagePath);
    if (previousPath !== finalPath) {
      await unlink(previousPath).catch(() => undefined);
    }
    if (previous.thumbnailPath) {
      const previousThumbnailPath = join(config.storageDir, "images", previous.thumbnailPath);
      if (previousThumbnailPath !== thumbnailFinalPath) {
        await unlink(previousThumbnailPath).catch(() => undefined);
      }
    }
  }

  return {
    intakeId: input.intakeId,
    imageId,
    jobId,
    imageRole: input.imageRole,
    status: "queued"
  };
}

export function retryIntake(user: RequestUser, intakeId: string) {
  const draft = requireDraft(user, intakeId);
  if (draft.status === "cancelled" || draft.status === "completed") {
    throw createError({ statusCode: 409, statusMessage: "该草稿不能重试" });
  }
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'queued', started_at = NULL, finished_at = NULL,
          elapsed_ms = NULL, error_code = NULL, error_message = NULL
      WHERE job_id IN (
        SELECT id FROM processing_jobs WHERE intake_id = ? AND job_type = 'ai' AND status = 'failed'
      )
    `).run(intakeId);
    const result = db.prepare(`
      UPDATE processing_jobs
      SET
        status = 'queued',
        stage = 'queued',
        attempts = 0,
        locked_at = NULL,
        lease_expires_at = NULL,
        next_retry_at = NULL,
        error_code = NULL,
        error_message = NULL,
        started_at = NULL,
        finished_at = NULL
      WHERE intake_id = ? AND status = 'failed'
    `).run(intakeId);
    db.prepare(`
      UPDATE intake_drafts
      SET status = 'queued', processing_stage = 'queued', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(intakeId);
    db.exec("COMMIT");
    return { intakeId, retriedJobs: Number(result.changes) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function rerunIntakeOcr(user: RequestUser, intakeId: string) {
  const draft = requireDraft(user, intakeId);
  if (draft.status === "cancelled" || draft.status === "completed") {
    throw createError({ statusCode: 409, statusMessage: "该草稿不能重新 OCR 识别" });
  }

  const db = getDatabase();
  const active = db.prepare(`
    SELECT
      SUM(CASE WHEN job_type = 'ocr' AND status = 'processing' THEN 1 ELSE 0 END) AS processingOcr,
      SUM(CASE WHEN job_type = 'ai' AND status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeAi
    FROM processing_jobs
    WHERE intake_id = ?
  `).get(intakeId) as { processingOcr: number | null; activeAi: number | null };
  if (Number(active.processingOcr || 0) > 0) {
    throw createError({ statusCode: 409, statusMessage: "OCR 正在识别中，请稍后再试" });
  }
  if (Number(active.activeAi || 0) > 0) {
    throw createError({ statusCode: 409, statusMessage: "AI 正在整理字段，请稍后再试" });
  }

  const media = db.prepare(`
    SELECT id, image_role AS imageRole, sha256
    FROM media_assets
    WHERE intake_id = ?
    ORDER BY CASE image_role WHEN 'product' THEN 1 WHEN 'label' THEN 2 ELSE 3 END
  `).all(intakeId) as Array<{ id: string; imageRole: string; sha256: string }>;
  if (!media.length) {
    throw createError({ statusCode: 409, statusMessage: "请先上传图片后再重新 OCR 识别" });
  }

  const runId = createId("ocr-run");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      DELETE FROM ocr_results
      WHERE job_id IN (
        SELECT id FROM processing_jobs WHERE intake_id = ? AND job_type = 'ocr'
      )
    `).run(intakeId);
    db.prepare(`
      DELETE FROM field_candidates
      WHERE intake_id = ? AND source IN ('ocr_rule', 'computed', 'ai') AND accepted_at IS NULL
    `).run(intakeId);
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND status IN ('queued', 'failed')
    `).run(intakeId);
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'superseded', locked_at = NULL, lease_expires_at = NULL,
          next_retry_at = NULL, finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ?
        AND job_type = 'ai'
        AND status IN ('queued', 'failed')
    `).run(intakeId);
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'superseded', locked_at = NULL, lease_expires_at = NULL,
          next_retry_at = NULL, finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ?
        AND job_type = 'ocr'
        AND status IN ('queued', 'completed', 'failed')
    `).run(intakeId);

    const insertJob = db.prepare(`
      INSERT INTO processing_jobs (
        id, intake_id, image_id, job_type, status, stage, pipeline_version, deduplication_key
      )
      VALUES (?, ?, ?, 'ocr', 'queued', 'queued', ?, ?)
    `);
    for (const item of media) {
      insertJob.run(
        createId("job"),
        intakeId,
        item.id,
        pipelineVersion,
        `${intakeId}:${item.imageRole}:${item.sha256}:${pipelineVersion}:${runId}`
      );
    }

    db.prepare(`
      UPDATE intake_drafts
      SET
        status = 'queued',
        processing_stage = 'queued',
        review_required = 0,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(intakeId);
    db.exec("COMMIT");
    return { intakeId, queuedJobs: media.length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function reextractIntakeAi(user: RequestUser, intakeId: string) {
  const draft = requireDraft(user, intakeId);
  if (draft.status === "completed" || draft.status === "cancelled") {
    throw createError({ statusCode: 409, statusMessage: "该草稿不能重新提取" });
  }
  const result = enqueueAiReExtraction(intakeId);
  if (!result.enqueued) {
    throw createError({ statusCode: 409, statusMessage: result.reason || "暂不能重新提取" });
  }
  return result;
}

export function cancelIntake(user: RequestUser, intakeId: string) {
  const draft = requireDraft(user, intakeId);
  if (draft.status === "completed") {
    throw createError({ statusCode: 409, statusMessage: "已完成的草稿不能取消" });
  }
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'cancelled', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND status IN ('queued', 'failed')
    `).run(intakeId);
    db.prepare(`
      UPDATE intake_drafts
      SET status = 'cancelled', processing_stage = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(intakeId);
    db.exec("COMMIT");
    return { intakeId, status: "cancelled" };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeIntake(
  user: RequestUser,
  intakeId: string,
  body: {
    values?: Record<string, unknown>;
    acceptedCandidateIds?: unknown;
    rejectedCandidateIds?: unknown;
  }
) {
  const draft = requireDraft(user, intakeId);
  if (draft.status === "completed") {
    throw createError({ statusCode: 409, statusMessage: "该草稿已经完成入库" });
  }
  if (draft.status === "cancelled") {
    throw createError({ statusCode: 409, statusMessage: "该草稿已取消" });
  }
  if (!["needs_review", "failed"].includes(draft.status)) {
    throw createError({ statusCode: 409, statusMessage: "识别任务尚未完成，暂不能确认入库" });
  }

  const existingValues = parseJson<Record<string, unknown>>(draft.userValuesJson, {});
  const submittedValues =
    body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : {};
  const values = { ...existingValues, ...submittedValues };
  const locationId = optionalText(values.locationId) || draft.locationId;
  const categoryId = optionalText(values.categoryId) || draft.categoryId;
  const shelfLife =
    values.shelfLife && typeof values.shelfLife === "object" && !Array.isArray(values.shelfLife)
      ? values.shelfLife as Record<string, unknown>
      : null;
  const input = parseManualStockInInput({
    ...values,
    familyId: draft.familyId,
    locationId,
    categoryId,
    shelfLifeValue: shelfLife?.value ?? values.shelfLifeValue,
    shelfLifeUnit: shelfLife?.unit ?? values.shelfLifeUnit,
    coverImageId: getProductCoverImageId(intakeId)
  });
  const acceptedIds = Array.isArray(body.acceptedCandidateIds)
    ? body.acceptedCandidateIds.filter((value): value is string => typeof value === "string")
    : [];
  const rejectedIds = Array.isArray(body.rejectedCandidateIds)
    ? body.rejectedCandidateIds.filter((value): value is string => typeof value === "string")
    : [];
  const db = getDatabase();
  let stockResult: ReturnType<typeof createManualStockIn>;

  db.exec("BEGIN IMMEDIATE");
  try {
    stockResult = createManualStockIn(input, user, { manageTransaction: false });
    if (acceptedIds.length) {
      const accept = db.prepare(`
        UPDATE field_candidates
        SET accepted_at = CURRENT_TIMESTAMP, rejected_at = NULL
        WHERE id = ? AND intake_id = ?
      `);
      for (const candidateId of acceptedIds) accept.run(candidateId, intakeId);
    }
    if (rejectedIds.length) {
      const reject = db.prepare(`
        UPDATE field_candidates
        SET rejected_at = CURRENT_TIMESTAMP, accepted_at = NULL
        WHERE id = ? AND intake_id = ?
      `);
      for (const candidateId of rejectedIds) reject.run(candidateId, intakeId);
    }
    db.prepare(`
      UPDATE intake_drafts
      SET
        status = 'completed',
        processing_stage = 'completed',
        location_id = ?,
        category_id = ?,
        user_values_json = ?,
        review_required = 0,
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.locationId, input.categoryId, JSON.stringify(values), intakeId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    intakeId,
    ...stockResult!
  };
}

function resolveImagePath(relativePath: string) {
  const imagesRoot = resolve(getAppConfig().storageDir, "images");
  const filePath = resolve(imagesRoot, normalize(relativePath));
  if (!filePath.startsWith(`${imagesRoot}/`) || basename(filePath).includes("..") || !extname(filePath)) {
    throw createError({ statusCode: 400, statusMessage: "图片路径无效" });
  }
  return filePath;
}

function mimeTypeFromPath(filePath: string, fallback: string) {
  const extension = extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return fallback;
}

async function generateThumbnailFromOriginal(mediaId: string, storagePath: string) {
  const originalPath = resolveImagePath(storagePath);
  if (!existsSync(originalPath)) return null;

  const thumbnailPath = join(dirname(storagePath), `${mediaId}-thumb.jpg`);
  const thumbnailFinalPath = resolveImagePath(thumbnailPath);
  if (existsSync(thumbnailFinalPath)) return thumbnailPath;

  try {
    const image = await Jimp.read(originalPath);
    const buffer = await image.cover({ w: 120, h: 120 }).getBuffer(JimpMime.jpeg, { quality: 78 });
    const temporaryPath = `${thumbnailFinalPath}.${createId("tmp")}`;
    await writeFile(temporaryPath, buffer, { flag: "wx" });
    await rename(temporaryPath, thumbnailFinalPath);
    getDatabase().prepare(`
      UPDATE media_assets
      SET thumbnail_path = ?
      WHERE id = ?
    `).run(thumbnailPath, mediaId);
    return thumbnailPath;
  } catch {
    return null;
  }
}

export async function getMediaAsset(user: RequestUser, mediaId: string, options: { variant?: string } = {}) {
  const row = getDatabase().prepare(`
    SELECT
      m.storage_path AS storagePath,
      m.thumbnail_path AS thumbnailPath,
      m.mime_type AS mimeType
    FROM media_assets m
    JOIN intake_drafts d ON d.id = m.intake_id
    JOIN family_members fm
      ON fm.family_id = d.family_id AND fm.user_id = ?
    WHERE m.id = ?
  `).get(user.id, mediaId) as { storagePath: string; thumbnailPath: string | null; mimeType: string } | undefined;
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "图片不存在" });
  }

  if (options.variant === "thumb" && row.thumbnailPath) {
    const thumbnailPath = resolveImagePath(row.thumbnailPath);
    if (existsSync(thumbnailPath)) {
      return { filePath: thumbnailPath, mimeType: mimeTypeFromPath(thumbnailPath, row.mimeType) };
    }
  }
  if (options.variant === "thumb") {
    const generatedThumbnailPath = await generateThumbnailFromOriginal(mediaId, row.storagePath);
    if (generatedThumbnailPath) {
      const thumbnailPath = resolveImagePath(generatedThumbnailPath);
      return { filePath: thumbnailPath, mimeType: "image/jpeg" };
    }
  }

  const filePath = resolveImagePath(row.storagePath);
  return { filePath, mimeType: row.mimeType };
}
