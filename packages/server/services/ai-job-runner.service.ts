import { getDatabase } from "../database/client";
import { createId } from "../utils/identifier";
import { getAppConfig } from "../utils/runtime-config";
import { writeLog } from "../utils/logger";
import { aiProviderCatalog, createAiProvider, type AiExtractionRequest, type AiFieldCandidate, type AiOcrLine } from "./ai-provider";
import { getResolvedAiSettings } from "./ai-settings.service";
import { calculateExpirationDate } from "./ocr-rule-parser";
import { createManualStockIn, parseManualStockInInput } from "./inventory.service";
import type { RequestUser } from "../utils/request-user";

const aiPipelineVersion = "ai-extraction-v1";
const supportedFields = [
  "categoryKey",
  "name",
  "brand",
  "specification",
  "ingredients",
  "productionDate",
  "shelfLife",
  "expirationDate"
];

type AiJob = {
  id: string;
  intakeId: string;
  attempts: number;
  runId: string;
  basedOnVersion: number;
  forceExtract: boolean;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isEmptyValue(value: unknown) {
  return value === null || value === undefined || value === "";
}

function hasMeaningfulText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function finishDraftWithoutAi(intakeId: string, hasOcrResult: boolean) {
  getDatabase().prepare(`
    UPDATE intake_drafts
    SET status = ?, processing_stage = ?, review_required = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status NOT IN ('completed', 'cancelled')
  `).run(hasOcrResult ? "needs_review" : "failed", hasOcrResult ? "needs_review" : "failed", intakeId);
}

export function enqueueAiExtraction(intakeId: string) {
  const db = getDatabase();
  const draft = db.prepare(`
    SELECT id, version, status
    FROM intake_drafts
    WHERE id = ?
  `).get(intakeId) as { id: string; version: number; status: string } | undefined;
  if (!draft || ["completed", "cancelled"].includes(draft.status)) return false;

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN job_type = 'ocr' AND status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeOcr,
      SUM(CASE WHEN job_type = 'ai' AND status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeAi,
      (SELECT COUNT(*) FROM ocr_results r
        JOIN processing_jobs j2 ON j2.id = r.job_id WHERE j2.intake_id = ?) AS resultCount
    FROM processing_jobs
    WHERE intake_id = ?
  `).get(intakeId, intakeId) as { activeOcr: number | null; activeAi: number | null; resultCount: number | null };
  if (Number(counts.activeOcr || 0) > 0 || Number(counts.activeAi || 0) > 0) return false;

  const resultCount = Number(counts.resultCount || 0);
  const settings = getResolvedAiSettings();
  if (!settings.enabled || !settings.apiKey || !resultCount) {
    finishDraftWithoutAi(intakeId, resultCount > 0);
    return false;
  }

  const jobId = createId("job");
  const runId = createId("ai-run");
  const previousRuns = db.prepare(`
    SELECT COUNT(*) AS count FROM ai_extraction_runs
    WHERE intake_id = ? AND purpose = 'extraction'
  `).get(intakeId) as { count: number };
  const deduplicationKey = `${intakeId}:ai:${draft.version}:${settings.provider}:${settings.model}:${aiPipelineVersion}:${Number(previousRuns.count) + 1}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'superseded', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND job_type = 'ai' AND status = 'failed'
    `).run(intakeId);
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO processing_jobs (
        id, intake_id, image_id, job_type, status, stage, pipeline_version,
        deduplication_key, next_retry_at
      ) VALUES (?, ?, NULL, 'ai', 'queued', 'ai_queued', ?, ?, datetime('now', '+3 seconds'))
    `).run(jobId, intakeId, aiPipelineVersion, deduplicationKey);
    if (Number(inserted.changes) > 0) {
      db.prepare(`
        INSERT INTO ai_extraction_runs (
          id, job_id, intake_id, purpose, provider, model, based_on_version, status
        ) VALUES (?, ?, ?, 'extraction', ?, ?, ?, 'queued')
      `).run(runId, jobId, intakeId, settings.provider, settings.model, draft.version);
    }
    if (Number(inserted.changes) > 0) {
      db.prepare(`
        UPDATE intake_drafts
        SET status = 'queued', processing_stage = 'ai_queued', review_required = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(intakeId);
    }
    db.exec("COMMIT");
    return Number(inserted.changes) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function enqueueEligibleAiDrafts() {
  const rows = getDatabase().prepare(`
    SELECT DISTINCT d.id
    FROM intake_drafts d
    JOIN processing_jobs ocr ON ocr.intake_id = d.id AND ocr.job_type = 'ocr' AND ocr.status = 'completed'
    WHERE d.status IN ('needs_review', 'failed', 'queued')
      AND NOT EXISTS (
        SELECT 1 FROM processing_jobs active
        WHERE active.intake_id = d.id AND active.status IN ('queued', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM ai_extraction_runs completed
        WHERE completed.intake_id = d.id AND completed.status = 'completed'
          AND completed.based_on_version = d.version
      )
    LIMIT 50
  `).all() as Array<{ id: string }>;
  let enqueued = 0;
  for (const row of rows) if (enqueueAiExtraction(row.id)) enqueued += 1;
  return enqueued;
}

export function enqueueAiReExtraction(intakeId: string) {
  const db = getDatabase();
  const draft = db.prepare(`
    SELECT id, version, status
    FROM intake_drafts
    WHERE id = ?
  `).get(intakeId) as { id: string; version: number; status: string } | undefined;
  if (!draft || ["completed", "cancelled"].includes(draft.status)) return { intakeId, enqueued: false, reason: "草稿不能重新提取" };

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN job_type = 'ocr' AND status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeOcr,
      SUM(CASE WHEN job_type = 'ai' AND status IN ('queued', 'processing') THEN 1 ELSE 0 END) AS activeAi,
      (SELECT COUNT(*) FROM ocr_results r
        JOIN processing_jobs j2 ON j2.id = r.job_id WHERE j2.intake_id = ?) AS resultCount
    FROM processing_jobs
    WHERE intake_id = ?
  `).get(intakeId, intakeId) as { activeOcr: number | null; activeAi: number | null; resultCount: number | null };
  if (Number(counts.activeOcr || 0) > 0) return { intakeId, enqueued: false, reason: "OCR 仍在处理中，请稍后再试" };
  if (Number(counts.activeAi || 0) > 0) return { intakeId, enqueued: false, reason: "AI 正在提取中，请稍后再试" };
  if (Number(counts.resultCount || 0) <= 0) return { intakeId, enqueued: false, reason: "暂无 OCR 结果，不能重新提取" };

  const settings = getResolvedAiSettings();
  if (!settings.enabled || !settings.apiKey) {
    const label = aiProviderCatalog[settings.provider]?.label || "AI";
    return { intakeId, enqueued: false, reason: `请先启用 AI 并配置 ${label} API Key` };
  }

  const jobId = createId("job");
  const runId = createId("ai-run");
  const previousRuns = db.prepare(`
    SELECT COUNT(*) AS count FROM ai_extraction_runs
    WHERE intake_id = ? AND purpose = 'extraction'
  `).get(intakeId) as { count: number };
  const pipelineVersion = `${aiPipelineVersion}:manual`;
  const deduplicationKey = `${intakeId}:ai:${draft.version}:${settings.provider}:${settings.model}:${pipelineVersion}:${Number(previousRuns.count) + 1}`;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'cancelled', stage = 'superseded', finished_at = CURRENT_TIMESTAMP
      WHERE intake_id = ? AND job_type = 'ai' AND status = 'failed'
    `).run(intakeId);
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP
      WHERE job_id IN (
        SELECT id FROM processing_jobs WHERE intake_id = ? AND job_type = 'ai' AND status = 'cancelled'
      ) AND status = 'failed'
    `).run(intakeId);
    db.prepare(`
      DELETE FROM field_candidates
      WHERE intake_id = ? AND source = 'ai' AND accepted_at IS NULL
    `).run(intakeId);
    db.prepare(`
      INSERT INTO processing_jobs (
        id, intake_id, image_id, job_type, status, stage, pipeline_version,
        deduplication_key, next_retry_at
      ) VALUES (?, ?, NULL, 'ai', 'queued', 'ai_queued', ?, ?, CURRENT_TIMESTAMP)
    `).run(jobId, intakeId, pipelineVersion, deduplicationKey);
    db.prepare(`
      INSERT INTO ai_extraction_runs (
        id, job_id, intake_id, purpose, provider, model, based_on_version, status
      ) VALUES (?, ?, ?, 'extraction', ?, ?, ?, 'queued')
    `).run(runId, jobId, intakeId, settings.provider, settings.model, draft.version);
    db.prepare(`
      UPDATE intake_drafts
      SET status = 'queued', processing_stage = 'ai_queued', review_required = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(intakeId);
    db.exec("COMMIT");
    return { intakeId, enqueued: true, jobId };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function buildExtractionRequest(job: AiJob): AiExtractionRequest {
  const db = getDatabase();
  const draft = db.prepare(`
    SELECT d.category_id AS categoryId, c.system_key AS categoryKey, c.fields_json AS currentFieldsJson,
           d.user_values_json AS userValuesJson
    FROM intake_drafts d
    LEFT JOIN category_templates c ON c.id = d.category_id
    WHERE d.id = ?
  `).get(job.intakeId) as {
    categoryId: string | null;
    categoryKey: string | null;
    currentFieldsJson: string | null;
    userValuesJson: string;
  };
  const userValues = parseJson<Record<string, unknown>>(draft.userValuesJson, {});
  const resolvedRows = db.prepare(`
      SELECT field_key AS fieldKey, value_json AS valueJson, source, confidence
      FROM field_candidates
      WHERE intake_id = ? AND source IN ('barcode', 'ocr_rule', 'computed')
        AND rejected_at IS NULL
      ORDER BY CASE source WHEN 'barcode' THEN 1 WHEN 'ocr_rule' THEN 2 ELSE 3 END,
        confidence DESC, created_at DESC
    `).all(job.intakeId) as Array<{ fieldKey: string; valueJson: string; source: string; confidence: number | null }>;
  const resolvedRuleFields = new Set(resolvedRows.map((row) => row.fieldKey));
  const currentFields = parseJson<{ expirationEnabled?: boolean; enabled?: string[] }>(draft.currentFieldsJson, {});
  const enabledCategoryFields = new Set(currentFields.enabled || []);
  const commonFields = new Set(["categoryKey", "name", "brand", "specification"]);
  const unresolvedFields = supportedFields.filter((fieldKey) => {
    if (currentFields.expirationEnabled === false && ["productionDate", "shelfLife", "expirationDate"].includes(fieldKey)) {
      return false;
    }
    if (draft.categoryKey && !commonFields.has(fieldKey) && !enabledCategoryFields.has(fieldKey)) return false;
    if (job.forceExtract) return true;
    const storedKey = fieldKey === "categoryKey" ? "categoryId" : fieldKey;
    return isEmptyValue(userValues[storedKey]) && !resolvedRuleFields.has(storedKey);
  });

  const categories = db.prepare(`
    SELECT system_key AS key, name, fields_json AS fieldsJson
    FROM category_templates
    ORDER BY sort_order
  `).all() as Array<{ key: string; name: string; fieldsJson: string }>;
  const rawLines = db.prepare(`
    SELECT r.image_id AS imageId, m.image_role AS imageRole, r.lines_json AS linesJson
    FROM ocr_results r
    JOIN processing_jobs j ON j.id = r.job_id
    JOIN media_assets m ON m.id = r.image_id
    WHERE j.intake_id = ?
    ORDER BY m.created_at, r.created_at
  `).all(job.intakeId) as Array<{ imageId: string; imageRole: string; linesJson: string }>;
  const lines: AiOcrLine[] = rawLines.flatMap((row) =>
    parseJson<Array<{ id?: unknown; text?: unknown; confidence?: unknown }>>(row.linesJson, [])
      .filter((line) => typeof line.text === "string" && line.text.trim())
      .map((line, index) => ({
        id: `${row.imageId}:${typeof line.id === "string" ? line.id : index}`,
        text: String(line.text).slice(0, 300),
        confidence: typeof line.confidence === "number" ? line.confidence : 0,
        imageId: row.imageId,
        imageRole: row.imageRole
      }))
  );
  return {
    intakeId: job.intakeId,
    basedOnVersion: job.basedOnVersion,
    categories: categories.map((category) => ({
      key: category.key,
      name: category.name,
      enabledFields: parseJson<{ enabled?: string[] }>(category.fieldsJson, {}).enabled || []
    })),
    currentCategoryKey: draft.categoryKey,
    resolvedFields: resolvedRows.map((row) => ({
      fieldKey: row.fieldKey,
      value: parseJson(row.valueJson, null),
      source: row.source,
      confidence: row.confidence
    })),
    unresolvedFields,
    lines
  };
}

function claimJob() {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = db.prepare(`
      SELECT j.id, j.intake_id AS intakeId, j.attempts,
             r.id AS runId, r.based_on_version AS basedOnVersion,
             j.pipeline_version AS pipelineVersion
      FROM processing_jobs j
      JOIN ai_extraction_runs r ON r.job_id = j.id
      WHERE j.job_type = 'ai' AND j.status = 'queued'
        AND (j.next_retry_at IS NULL OR j.next_retry_at <= CURRENT_TIMESTAMP)
      ORDER BY j.created_at
      LIMIT 1
    `).get() as AiJob | undefined;
    if (!job) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'processing', stage = 'ai_processing', attempts = attempts + 1,
          locked_at = CURRENT_TIMESTAMP, lease_expires_at = datetime('now', '+3 minutes'),
          started_at = COALESCE(started_at, CURRENT_TIMESTAMP), error_code = NULL, error_message = NULL
      WHERE id = ?
    `).run(job.id);
    db.prepare(`
      UPDATE ai_extraction_runs SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(job.runId);
    db.prepare(`
      UPDATE intake_drafts SET status = 'ai_processing', processing_stage = 'ai_processing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status NOT IN ('completed', 'cancelled')
    `).run(job.intakeId);
    db.exec("COMMIT");
    return {
      ...job,
      attempts: Number(job.attempts) + 1,
      forceExtract: String((job as AiJob & { pipelineVersion?: string }).pipelineVersion || "").includes(":manual")
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function candidateEvidence(candidate: AiFieldCandidate, request: AiExtractionRequest, provider: string, model: string) {
  const lines = request.lines.filter((line) => candidate.sourceLineIds.includes(line.id));
  return {
    lineIds: candidate.sourceLineIds,
    sourceText: lines.map((line) => line.text).join("；").slice(0, 1000),
    imageIds: [...new Set(lines.map((line) => line.imageId))],
    imageRoles: [...new Set(lines.map((line) => line.imageRole))],
    ocrConfidence: lines.length ? Math.min(...lines.map((line) => line.confidence)) : null,
    provider,
    model
  };
}

type BestCandidateRow = {
  id: string;
  fieldKey: string;
  valueJson: string;
  source: string;
  confidence: number;
  evidenceJson: string;
  basedOnVersion: number;
};

type AutoStockBuildResult = {
  values: Record<string, unknown>;
  candidateIds: string[];
  stockInputBody: Record<string, unknown>;
};

function collectBestCandidateValues(intakeId: string) {
  const rows = getDatabase().prepare(`
    SELECT
      id,
      field_key AS fieldKey,
      value_json AS valueJson,
      source,
      confidence,
      evidence_json AS evidenceJson,
      based_on_version AS basedOnVersion
    FROM field_candidates
    WHERE intake_id = ? AND rejected_at IS NULL
    ORDER BY CASE source
      WHEN 'barcode' THEN 1 WHEN 'ai' THEN 2 WHEN 'computed' THEN 3 WHEN 'ocr_rule' THEN 4 ELSE 5 END,
      confidence DESC, created_at DESC
  `).all(intakeId) as BestCandidateRow[];
  const best = new Map<string, BestCandidateRow>();
  for (const candidate of rows) {
    if (!best.has(candidate.fieldKey)) best.set(candidate.fieldKey, candidate);
  }
  return best;
}

function buildAutoStockValues(
  intakeId: string,
  userValues: Record<string, unknown>,
  fieldVersions: Record<string, number>
): AutoStockBuildResult {
  const best = collectBestCandidateValues(intakeId);
  const values = { ...userValues };
  const candidateIds: string[] = [];

  for (const [fieldKey, candidate] of best.entries()) {
    if (fieldKey === "categoryKey") continue;
    const userChangedAfterCandidate = Number(fieldVersions[fieldKey] || 0) > Number(candidate.basedOnVersion || 0);
    if (!isEmptyValue(values[fieldKey]) && userChangedAfterCandidate) continue;
    values[fieldKey] = parseJson(candidate.valueJson, null);
    candidateIds.push(candidate.id);
  }

  const shelfLife =
    values.shelfLife && typeof values.shelfLife === "object" && !Array.isArray(values.shelfLife)
      ? values.shelfLife as Record<string, unknown>
      : null;

  return {
    values,
    candidateIds,
    stockInputBody: {
      ...values,
      shelfLifeValue: shelfLife?.value ?? values.shelfLifeValue,
      shelfLifeUnit: shelfLife?.unit ?? values.shelfLifeUnit
    }
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

function getCategoryAutoMeta(categoryId: string) {
  return getDatabase().prepare(`
    SELECT system_key AS systemKey, name, fields_json AS fieldsJson
    FROM category_templates
    WHERE id = ?
  `).get(categoryId) as { systemKey: string; name: string; fieldsJson: string } | undefined;
}

function isValidDateValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidShelfLifeValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as { value?: unknown; unit?: unknown };
  return Number.isInteger(data.value) &&
    Number(data.value) > 0 &&
    ["day", "month", "year"].includes(String(data.unit || ""));
}

function shelfLifeFromValues(values: Record<string, unknown>) {
  if (isValidShelfLifeValue(values.shelfLife)) return values.shelfLife;
  const value = Number(values.shelfLifeValue);
  const unit = typeof values.shelfLifeUnit === "string" ? values.shelfLifeUnit : "";
  if (Number.isInteger(value) && value > 0 && ["day", "month", "year"].includes(unit)) {
    return { value, unit };
  }
  return null;
}

function isLikelySpecificationOnly(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^[\d.]+\s*(ml|毫升|l|升|g|克|kg|千克|斤|包|袋|盒|瓶|罐|片|粒|枚|个|件|支|pcs?)$/i.test(normalized) ||
    /^净含量/.test(normalized);
}

function autoStockReadiness(
  categoryId: string,
  auto: AutoStockBuildResult,
  locationId: string
) {
  const category = getCategoryAutoMeta(categoryId);
  if (!category) return { ok: false, reason: "品类不存在" };
  const fields = parseJson<{ required?: string[]; expirationEnabled?: boolean }>(category.fieldsJson, {});
  const values = auto.values;
  const name = typeof values.name === "string" ? values.name.trim() : "";
  const quantity = Number(values.quantity);
  const unit = typeof values.unit === "string" ? values.unit.trim() : "";

  if (!name) return { ok: false, reason: "商品名称缺失" };
  if (isLikelySpecificationOnly(name)) return { ok: false, reason: "商品名称疑似规格值" };
  if (!categoryId) return { ok: false, reason: "品类缺失" };
  if (!locationId) return { ok: false, reason: "存放地点缺失" };
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: "数量缺失或无效" };
  if (!unit) return { ok: false, reason: "单位缺失" };

  for (const fieldKey of fields.required || []) {
    if (fieldKey === "shelfLife") {
      if (!isValidShelfLifeValue(shelfLifeFromValues(values))) return { ok: false, reason: "品类必填保质期缺失" };
      continue;
    }
    if (["productionDate", "expirationDate"].includes(fieldKey)) {
      if (!isValidDateValue(values[fieldKey])) return { ok: false, reason: `品类必填${fieldKey}缺失` };
      continue;
    }
    if (isEmptyValue(values[fieldKey])) return { ok: false, reason: `品类必填字段 ${fieldKey} 缺失` };
  }

  if (fields.expirationEnabled) {
    const hasExpirationDate = isValidDateValue(values.expirationDate);
    const canComputeExpiration = isValidDateValue(values.productionDate) && isValidShelfLifeValue(shelfLifeFromValues(values));
    if (!hasExpirationDate && !canComputeExpiration) {
      return { ok: false, reason: "启用保质期的品类缺少可信到期日期或生产日期+保质期" };
    }
  }
  if (category.systemKey === "food" && !hasMeaningfulText(values.ingredients)) {
    return { ok: false, reason: "食品饮料缺少配料表内容" };
  }

  return { ok: true, reason: null };
}

function tryAutoCompleteIntake(
  intakeId: string,
  baseValues: Record<string, unknown>,
  fieldVersions: Record<string, number>
) {
  const db = getDatabase();
  const draft = db.prepare(`
    SELECT
      d.family_id AS familyId,
      d.location_id AS locationId,
      d.category_id AS categoryId,
      d.created_by AS createdBy,
      u.display_name AS createdByName
    FROM intake_drafts d
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.id = ?
  `).get(intakeId) as {
    familyId: string;
    locationId: string | null;
    categoryId: string | null;
    createdBy: string;
    createdByName: string | null;
  } | undefined;
  if (!draft) return null;

  const auto = buildAutoStockValues(intakeId, baseValues, fieldVersions);
  const locationId = typeof auto.values.locationId === "string" && auto.values.locationId.trim()
    ? auto.values.locationId.trim()
    : draft.locationId;
  const categoryId = typeof auto.values.categoryId === "string" && auto.values.categoryId.trim()
    ? auto.values.categoryId.trim()
    : draft.categoryId;
  if (!locationId || !categoryId) return null;
  const readiness = autoStockReadiness(categoryId, auto, locationId);
  if (!readiness.ok) {
    void writeLog("info", "Auto stock-in skipped; manual review required", {
      intakeId,
      reason: readiness.reason
    });
    return null;
  }

  let input: ReturnType<typeof parseManualStockInInput>;
  try {
    input = parseManualStockInInput({
      ...auto.stockInputBody,
      familyId: draft.familyId,
      locationId,
      categoryId,
      coverImageId: getProductCoverImageId(intakeId)
    });
  } catch {
    return null;
  }

  const operator: RequestUser = {
    id: draft.createdBy,
    displayName: draft.createdByName || draft.createdBy,
    isGatewayAuthenticated: true,
    isGatewayAdmin: false
  };

  db.exec("SAVEPOINT auto_stock_in");
  try {
    const stockResult = createManualStockIn(input, operator, { manageTransaction: false });
    if (auto.candidateIds.length) {
      const accept = db.prepare(`
        UPDATE field_candidates
        SET accepted_at = CURRENT_TIMESTAMP, rejected_at = NULL
        WHERE id = ? AND intake_id = ?
      `);
      for (const candidateId of auto.candidateIds) accept.run(candidateId, intakeId);
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
    `).run(input.locationId, input.categoryId, JSON.stringify({ ...auto.values, locationId: input.locationId, categoryId: input.categoryId }), intakeId);
    db.exec("RELEASE SAVEPOINT auto_stock_in");
    return stockResult;
  } catch {
    db.exec("ROLLBACK TO SAVEPOINT auto_stock_in");
    db.exec("RELEASE SAVEPOINT auto_stock_in");
    return null;
  }
}

function completeJob(
  job: AiJob,
  request: AiExtractionRequest,
  result: Awaited<ReturnType<ReturnType<typeof createAiProvider>["extract"]>>,
  elapsedMs: number
) {
  const db = getDatabase();
  const settings = getResolvedAiSettings();
  const categoryRows = db.prepare(
    "SELECT id, system_key AS systemKey, fields_json AS fieldsJson FROM category_templates"
  ).all() as Array<{ id: string; systemKey: string; fieldsJson: string }>;
  const categoryMap = new Map(categoryRows.map((row) => [row.systemKey, row.id]));
  const inferredCategoryKey = result.candidates.find((candidate) => candidate.fieldKey === "categoryKey")?.value;
  const inferredCategory = typeof inferredCategoryKey === "string"
    ? categoryRows.find((row) => row.systemKey === inferredCategoryKey)
    : null;
  const inferredFields = parseJson<{ expirationEnabled?: boolean }>(inferredCategory?.fieldsJson || null, {});
  const mapped = result.candidates.flatMap((candidate) => {
    if (inferredFields.expirationEnabled === false && ["productionDate", "shelfLife", "expirationDate"].includes(candidate.fieldKey)) {
      return [];
    }
    if (candidate.fieldKey !== "categoryKey") return [candidate];
    const categoryId = typeof candidate.value === "string" ? categoryMap.get(candidate.value) : null;
    return categoryId ? [{ ...candidate, fieldKey: "categoryId", value: categoryId }] : [];
  });
  const userRow = db.prepare(`
    SELECT version, user_values_json AS userValuesJson, field_versions_json AS fieldVersionsJson
    FROM intake_drafts WHERE id = ?
  `).get(job.intakeId) as { version: number; userValuesJson: string; fieldVersionsJson: string };
  const userValues = parseJson<Record<string, unknown>>(userRow.userValuesJson, {});
  const fieldVersions = parseJson<Record<string, number>>(userRow.fieldVersionsJson, {});
  const newerOcr = db.prepare(`
    SELECT COUNT(*) AS count FROM processing_jobs
    WHERE intake_id = ? AND job_type = 'ocr' AND status IN ('queued', 'processing')
  `).get(job.intakeId) as { count: number };
  const safeCandidateVersion = (fieldKey: string) =>
    isEmptyValue(userValues[fieldKey]) &&
    Number(fieldVersions[fieldKey] || 0) <= job.basedOnVersion &&
    Number(newerOcr.count) === 0
      ? userRow.version
      : job.basedOnVersion;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      DELETE FROM field_candidates
      WHERE intake_id = ? AND source = 'ai' AND accepted_at IS NULL AND rejected_at IS NULL
    `).run(job.intakeId);
    const insert = db.prepare(`
      INSERT INTO field_candidates (
        id, intake_id, field_key, value_json, source, confidence, evidence_json, based_on_version
      ) VALUES (?, ?, ?, ?, 'ai', ?, ?, ?)
    `);
    for (const candidate of mapped) {
      insert.run(
        createId("candidate"),
        job.intakeId,
        candidate.fieldKey,
        JSON.stringify(candidate.value),
        candidate.confidence,
        JSON.stringify(candidateEvidence(candidate, request, settings.provider, settings.model)),
        safeCandidateVersion(candidate.fieldKey)
      );
    }

    const allCandidates = db.prepare(`
      SELECT field_key AS fieldKey, value_json AS valueJson, confidence, evidence_json AS evidenceJson
      FROM field_candidates
      WHERE intake_id = ? AND rejected_at IS NULL
      ORDER BY CASE source
        WHEN 'barcode' THEN 1 WHEN 'ocr_rule' THEN 2 WHEN 'computed' THEN 3 ELSE 4 END,
        confidence DESC, created_at DESC
    `).all(job.intakeId) as Array<{ fieldKey: string; valueJson: string; confidence: number; evidenceJson: string }>;
    const best = new Map<string, typeof allCandidates[number]>();
    for (const candidate of allCandidates) if (!best.has(candidate.fieldKey)) best.set(candidate.fieldKey, candidate);
    if (!best.has("expirationDate") && best.has("productionDate") && best.has("shelfLife")) {
      const productionDate = parseJson<string>(best.get("productionDate")!.valueJson, "");
      const shelfLife = parseJson<{ value: number; unit: "day" | "month" | "year" }>(best.get("shelfLife")!.valueJson, { value: 0, unit: "day" });
      if (productionDate && shelfLife.value > 0) {
        insert.run(
          createId("candidate"), job.intakeId, "expirationDate",
          JSON.stringify(calculateExpirationDate(productionDate, shelfLife)),
          Math.min(best.get("productionDate")!.confidence, best.get("shelfLife")!.confidence) * 0.9,
          JSON.stringify({
            lineIds: [
              ...parseJson<{ lineIds?: string[] }>(best.get("productionDate")!.evidenceJson, {}).lineIds || [],
              ...parseJson<{ lineIds?: string[] }>(best.get("shelfLife")!.evidenceJson, {}).lineIds || []
            ],
            sourceText: "由生产日期和保质期计算",
            computed: true
          }),
          safeCandidateVersion("expirationDate")
        );
        db.prepare("UPDATE field_candidates SET source = 'computed' WHERE id = (SELECT id FROM field_candidates WHERE intake_id = ? AND field_key = 'expirationDate' ORDER BY created_at DESC LIMIT 1)")
          .run(job.intakeId);
      }
    }

    db.prepare(`
      UPDATE processing_jobs
      SET status = 'completed', stage = 'completed', locked_at = NULL, lease_expires_at = NULL,
          next_retry_at = NULL, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(job.id);
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'completed', prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
          elapsed_ms = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(result.usage.promptTokens, result.usage.completionTokens, result.usage.totalTokens, elapsedMs, job.runId);
    const active = db.prepare(`
      SELECT COUNT(*) AS count FROM processing_jobs
      WHERE intake_id = ? AND status IN ('queued', 'processing') AND id != ?
    `).get(job.intakeId, job.id) as { count: number };
    const hasActiveJobs = Number(active.count) > 0;
    const autoStockResult = hasActiveJobs ? null : tryAutoCompleteIntake(job.intakeId, userValues, fieldVersions);
    if (!autoStockResult) {
      db.prepare(`
        UPDATE intake_drafts
        SET status = ?, processing_stage = ?, review_required = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status NOT IN ('completed', 'cancelled')
      `).run(hasActiveJobs ? "queued" : "needs_review", hasActiveJobs ? "queued" : "needs_review", hasActiveJobs ? 0 : 1, job.intakeId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function failJob(job: AiJob, error: unknown, elapsedMs: number) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error && "code" in error
    ? String((error as Error & { code?: string }).code || "AI_EXTRACTION_FAILED")
    : "AI_EXTRACTION_FAILED";
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'failed', stage = 'failed', locked_at = NULL, lease_expires_at = NULL,
          error_code = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(code, message.slice(0, 500), job.id);
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'failed', error_code = ?, error_message = ?, elapsed_ms = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(code, message.slice(0, 500), elapsedMs, job.runId);
    db.prepare(`
      UPDATE intake_drafts
      SET status = 'needs_review', processing_stage = 'needs_review', review_required = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status NOT IN ('completed', 'cancelled')
    `).run(job.intakeId);
    db.exec("COMMIT");
  } catch (databaseError) {
    db.exec("ROLLBACK");
    throw databaseError;
  }
  return { code, message };
}

class AiJobRunner {
  private started = false;
  private stopped = false;
  private working = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.schedule(250);
  }

  private schedule(delay = getAppConfig().ocrPollIntervalMs) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private recoverExpiredJobs() {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, intake_id AS intakeId FROM processing_jobs
      WHERE job_type = 'ai' AND status = 'processing'
        AND lease_expires_at IS NOT NULL AND lease_expires_at <= CURRENT_TIMESTAMP
    `).all() as Array<{ id: string; intakeId: string }>;
    for (const row of rows) {
      db.prepare(`
        UPDATE processing_jobs SET status = 'failed', stage = 'failed', error_code = 'AI_LEASE_EXPIRED',
          error_message = 'AI 任务执行超时', finished_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(row.id);
      db.prepare(`
        UPDATE ai_extraction_runs SET status = 'failed', error_code = 'AI_LEASE_EXPIRED',
          error_message = 'AI 任务执行超时', finished_at = CURRENT_TIMESTAMP WHERE job_id = ?
      `).run(row.id);
      finishDraftWithoutAi(row.intakeId, true);
    }
  }

  private async tick() {
    if (this.working || this.stopped) return this.schedule();
    this.working = true;
    try {
      this.recoverExpiredJobs();
      const job = claimJob();
      if (!job) return;
      const request = buildExtractionRequest(job);
      if (!request.unresolvedFields.length || !request.lines.length) {
        completeJob(job, request, { candidates: [], usage: { promptTokens: null, completionTokens: null, totalTokens: null } }, 0);
        return;
      }
      const settings = getResolvedAiSettings();
      if (!settings.enabled || !settings.apiKey) throw new Error("AI 配置已停用或 API Key 不可用");
      const startedAt = Date.now();
      try {
        const result = await createAiProvider(settings).extract(request);
        completeJob(job, request, result, Date.now() - startedAt);
      } catch (error) {
        const failed = failJob(job, error, Date.now() - startedAt);
        await writeLog("warn", "AI extraction failed; manual review remains available", {
          jobId: job.id,
          intakeId: job.intakeId,
          code: failed.code
        });
      }
    } catch (error) {
      await writeLog("error", "AI runner tick failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.working = false;
      this.schedule();
    }
  }

  getStatus() {
    const counts = getDatabase().prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM processing_jobs WHERE job_type = 'ai'
    `).get() as { queued: number | null; processing: number | null; failed: number | null };
    return {
      queued: Number(counts.queued || 0),
      processing: Number(counts.processing || 0),
      failed: Number(counts.failed || 0),
      runnerStarted: this.started && !this.stopped
    };
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const aiJobRunner = new AiJobRunner();
