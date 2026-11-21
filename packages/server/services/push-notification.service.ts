import { createError } from "h3";
import { getDatabase } from "../database/client";
import { writeLog } from "../utils/logger";
import { decryptAiSecret, encryptAiSecret } from "./ai-secret.service";
import {
  buildPushPayload,
  computeSchedulePeriodKey,
  maskWebhookUrl,
  type DigestExpiringRow,
  type DigestLowStockRow,
  type PushChannel,
  type PushDigest,
  type PushSchedule
} from "./push-notification.helpers";

export { buildPushPayload, computeSchedulePeriodKey, maskWebhookUrl };
export type { PushChannel, PushDigest, PushSchedule };

export type PushSettingsView = {
  enabled: boolean;
  channel: PushChannel;
  webhookConfigured: boolean;
  webhookUrlMask: string;
  schedule: PushSchedule;
  weekday: number;
  sendHour: number;
  expiringDays: number;
  familyIds: string[];
  includeLowStock: boolean;
  onlyWhenNonEmpty: boolean;
  lastSentAt: string | null;
  lastStatus: "idle" | "sent" | "skipped" | "failed";
  lastMessage: string | null;
};

type StoredPushSettings = {
  enabled?: boolean;
  channel?: PushChannel;
  webhookUrlEncrypted?: string;
  schedule?: PushSchedule;
  weekday?: number;
  sendHour?: number;
  expiringDays?: number;
  familyIds?: string[];
  includeLowStock?: boolean;
  onlyWhenNonEmpty?: boolean;
  lastSentAt?: string | null;
  lastPeriodKey?: string | null;
  lastStatus?: "idle" | "sent" | "skipped" | "failed";
  lastMessage?: string | null;
};

const settingKey = "push_notification_settings";
const validChannels = new Set<PushChannel>(["wecom", "feishu", "dingtalk", "bark", "webhook"]);
const validSchedules = new Set<PushSchedule>(["weekly", "daily"]);

function parseStoredSettings(): StoredPushSettings {
  const row = getDatabase().prepare(`
    SELECT value_json AS valueJson
    FROM app_settings
    WHERE setting_key = ?
  `).get(settingKey) as { valueJson: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.valueJson) as StoredPushSettings;
  } catch {
    return {};
  }
}

function saveStoredSettings(next: StoredPushSettings) {
  getDatabase().prepare(`
    INSERT INTO app_settings (setting_key, value_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(settingKey, JSON.stringify(next));
}

function normalizeChannel(value: unknown): PushChannel {
  return typeof value === "string" && validChannels.has(value as PushChannel)
    ? (value as PushChannel)
    : "wecom";
}

function normalizeSchedule(value: unknown): PushSchedule {
  return typeof value === "string" && validSchedules.has(value as PushSchedule)
    ? (value as PushSchedule)
    : "weekly";
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function normalizeFamilyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

function decryptWebhookUrl(encrypted: string | undefined) {
  if (!encrypted) return "";
  try {
    return decryptAiSecret(encrypted);
  } catch {
    return "";
  }
}

function validateWebhookUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "推送地址格式无效，请输入完整的 http/https URL" });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createError({ statusCode: 400, statusMessage: "推送地址仅支持 http 或 https 协议" });
  }
  return parsed.toString();
}

export function getPushSettings(): PushSettingsView {
  const stored = parseStoredSettings();
  const decryptedUrl = decryptWebhookUrl(stored.webhookUrlEncrypted);
  return {
    enabled: Boolean(stored.enabled),
    channel: normalizeChannel(stored.channel),
    webhookConfigured: Boolean(decryptedUrl),
    webhookUrlMask: maskWebhookUrl(decryptedUrl),
    schedule: normalizeSchedule(stored.schedule),
    weekday: clampInteger(stored.weekday, 1, 0, 6),
    sendHour: clampInteger(stored.sendHour, 9, 0, 23),
    expiringDays: clampInteger(stored.expiringDays, 14, 1, 90),
    familyIds: normalizeFamilyIds(stored.familyIds),
    includeLowStock: stored.includeLowStock !== false,
    onlyWhenNonEmpty: stored.onlyWhenNonEmpty !== false,
    lastSentAt: stored.lastSentAt || null,
    lastStatus: stored.lastStatus || "idle",
    lastMessage: stored.lastMessage || null
  };
}

export function updatePushSettings(body: Record<string, unknown>): PushSettingsView {
  const current = parseStoredSettings();
  const next: StoredPushSettings = {
    ...current,
    enabled: Boolean(body.enabled),
    channel: normalizeChannel(body.channel ?? current.channel),
    schedule: normalizeSchedule(body.schedule ?? current.schedule),
    weekday: clampInteger(body.weekday ?? current.weekday, 1, 0, 6),
    sendHour: clampInteger(body.sendHour ?? current.sendHour, 9, 0, 23),
    expiringDays: clampInteger(body.expiringDays ?? current.expiringDays, 14, 1, 90),
    familyIds: body.familyIds !== undefined ? normalizeFamilyIds(body.familyIds) : normalizeFamilyIds(current.familyIds),
    includeLowStock: body.includeLowStock !== undefined ? Boolean(body.includeLowStock) : current.includeLowStock !== false,
    onlyWhenNonEmpty: body.onlyWhenNonEmpty !== undefined ? Boolean(body.onlyWhenNonEmpty) : current.onlyWhenNonEmpty !== false
  };

  if (body.clearWebhookUrl === true) {
    next.webhookUrlEncrypted = "";
  } else if (typeof body.webhookUrl === "string" && body.webhookUrl.trim()) {
    const validated = validateWebhookUrl(body.webhookUrl.trim());
    next.webhookUrlEncrypted = encryptAiSecret(validated);
  }

  if (next.enabled && !next.webhookUrlEncrypted) {
    throw createError({
      statusCode: 400,
      statusMessage: "启用推送前请先填写 Webhook 地址"
    });
  }

  saveStoredSettings(next);
  return getPushSettings();
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatPlace(locationName: string, storagePlaceName: string | null) {
  return storagePlaceName ? `${locationName}·${storagePlaceName}` : locationName;
}

export function buildPushDigest(expiringDays = 14, includeLowStock = true, familyIds: string[] = []): PushDigest {
  const db = getDatabase();
  const days = clampInteger(expiringDays, 14, 1, 90);
  const scopedFamilyIds = normalizeFamilyIds(familyIds);
  const familyFilterSql = scopedFamilyIds.length
    ? `AND p.family_id IN (${scopedFamilyIds.map(() => "?").join(", ")})`
    : "";
  const expiringRows = db.prepare(`
    SELECT
      f.name AS familyName,
      l.name AS locationName,
      sp.name AS storagePlaceName,
      p.name AS name,
      b.current_quantity AS quantity,
      b.unit AS unit,
      b.expiration_date AS expirationDate,
      CAST(julianday(date(b.expiration_date)) - julianday(date('now', 'localtime')) AS INTEGER) AS daysRemaining
    FROM inventory_batches b
    JOIN products p ON p.id = b.product_id
    JOIN families f ON f.id = p.family_id
    JOIN locations l ON l.id = b.location_id
    LEFT JOIN storage_places sp ON sp.id = b.storage_place_id
    WHERE p.deleted_at IS NULL
      AND b.status = 'active'
      AND b.current_quantity > 0
      AND b.expiration_date IS NOT NULL
      ${familyFilterSql}
      AND CAST(julianday(date(b.expiration_date)) - julianday(date('now', 'localtime')) AS INTEGER) <= ?
    ORDER BY daysRemaining ASC, b.expiration_date ASC
    LIMIT 30
  `).all(...scopedFamilyIds, days) as DigestExpiringRow[];

  const expired = expiringRows.filter((row) => Number(row.daysRemaining) < 0);
  const expiring = expiringRows.filter((row) => Number(row.daysRemaining) >= 0);

  const lowStock = includeLowStock
    ? (db.prepare(`
        SELECT
          f.name AS familyName,
          p.name AS name,
          COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.current_quantity ELSE 0 END), 0) AS quantity,
          p.low_stock_threshold AS threshold,
          p.default_unit AS unit
        FROM products p
        JOIN families f ON f.id = p.family_id
        LEFT JOIN inventory_batches b ON b.product_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.low_stock_threshold IS NOT NULL
          ${familyFilterSql}
        GROUP BY p.id
        HAVING quantity <= threshold
        ORDER BY quantity ASC, p.name
        LIMIT 20
      `).all(...scopedFamilyIds) as DigestLowStockRow[])
    : [];

  const totalCount = expired.length + expiring.length + lowStock.length;
  const title = totalCount
    ? `家藏提醒：${expired.length} 已过期 / ${expiring.length} 临期 / ${lowStock.length} 低库存`
    : "家藏提醒：当前库存状态良好";

  const lines: string[] = [];
  if (expired.length) {
    lines.push(`【已过期（${expired.length}）】`);
    for (const item of expired.slice(0, 8)) {
      lines.push(
        `- ${item.name}（${formatQty(Number(item.quantity))}${item.unit}，${item.familyName}/${formatPlace(item.locationName, item.storagePlaceName)}）已过期 ${Math.abs(Number(item.daysRemaining))} 天`
      );
    }
  }
  if (expiring.length) {
    lines.push(`【${days} 天内临期（${expiring.length}）】`);
    for (const item of expiring.slice(0, 8)) {
      const remaining = Number(item.daysRemaining) === 0 ? "今天到期" : `剩 ${item.daysRemaining} 天`;
      lines.push(
        `- ${item.name}（${formatQty(Number(item.quantity))}${item.unit}，${item.familyName}/${formatPlace(item.locationName, item.storagePlaceName)}）${remaining}（${item.expirationDate}）`
      );
    }
  }
  if (lowStock.length) {
    lines.push(`【低库存待补货（${lowStock.length}）】`);
    for (const item of lowStock.slice(0, 8)) {
      lines.push(
        `- ${item.name}（${item.familyName}）：当前 ${formatQty(Number(item.quantity))}${item.unit} / 阈值 ${formatQty(Number(item.threshold))}${item.unit}`
      );
    }
  }
  if (!lines.length) {
    lines.push(`未来 ${days} 天内暂无临期物品，也没有触发低库存阈值的商品。`);
  }

  const text = `${title}\n${lines.join("\n")}`;
  const markdown = `### ${title}\n${lines.join("\n")}`;

  return {
    generatedAt: new Date().toISOString(),
    expiringDays: days,
    expiredCount: expired.length,
    expiringCount: expiring.length,
    lowStockCount: lowStock.length,
    totalCount,
    title,
    markdown,
    text,
    expired,
    expiring,
    lowStock
  };
}

async function postPushMessage(channel: PushChannel, webhookUrl: string, digest: PushDigest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(buildPushPayload(channel, digest)),
      signal: controller.signal
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${bodyText ? `: ${bodyText.slice(0, 120)}` : ""}`);
    }
    return { statusCode: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testPushNotification(override?: {
  channel?: unknown;
  webhookUrl?: unknown;
  expiringDays?: unknown;
  includeLowStock?: unknown;
  familyIds?: unknown;
}) {
  const stored = parseStoredSettings();
  const channel = normalizeChannel(override?.channel ?? stored.channel);
  const rawUrl =
    typeof override?.webhookUrl === "string" && override.webhookUrl.trim()
      ? validateWebhookUrl(override.webhookUrl.trim())
      : decryptWebhookUrl(stored.webhookUrlEncrypted);

  if (!rawUrl) {
    throw createError({ statusCode: 400, statusMessage: "请先填写并保存推送 Webhook 地址" });
  }

  const expiringDays = clampInteger(override?.expiringDays ?? stored.expiringDays, 14, 1, 90);
  const includeLowStock = override?.includeLowStock !== undefined
    ? Boolean(override.includeLowStock)
    : stored.includeLowStock !== false;
  const familyIds = override?.familyIds !== undefined
    ? normalizeFamilyIds(override.familyIds)
    : normalizeFamilyIds(stored.familyIds);
  const digest = buildPushDigest(expiringDays, includeLowStock, familyIds);
  const testDigest: PushDigest = {
    ...digest,
    title: `【测试】${digest.title}`,
    text: `【测试推送】${digest.text}`,
    markdown: `### 【测试】${digest.title}\n${digest.text.split("\n").slice(1).join("\n")}`
  };

  await postPushMessage(channel, rawUrl, testDigest);
  return {
    ok: true,
    channel,
    title: testDigest.title,
    summary: {
      expiredCount: digest.expiredCount,
      expiringCount: digest.expiringCount,
      lowStockCount: digest.lowStockCount
    }
  };
}

export async function sendPushDigestNow(options: { scheduled?: boolean; periodKey?: string } = {}) {
  const stored = parseStoredSettings();
  const channel = normalizeChannel(stored.channel);
  const webhookUrl = decryptWebhookUrl(stored.webhookUrlEncrypted);
  if (!webhookUrl) {
    throw createError({ statusCode: 400, statusMessage: "尚未配置推送 Webhook 地址" });
  }

  const expiringDays = clampInteger(stored.expiringDays, 14, 1, 90);
  const includeLowStock = stored.includeLowStock !== false;
  const onlyWhenNonEmpty = stored.onlyWhenNonEmpty !== false;
  const familyIds = normalizeFamilyIds(stored.familyIds);
  const digest = buildPushDigest(expiringDays, includeLowStock, familyIds);

  if (options.scheduled && onlyWhenNonEmpty && digest.totalCount === 0) {
    saveStoredSettings({
      ...stored,
      lastSentAt: new Date().toISOString(),
      lastPeriodKey: options.periodKey ?? stored.lastPeriodKey ?? null,
      lastStatus: "skipped",
      lastMessage: "当前无临期或低库存商品，已跳过推送"
    });
    return { sent: false, skipped: true, digest };
  }

  try {
    await postPushMessage(channel, webhookUrl, digest);
    saveStoredSettings({
      ...stored,
      lastSentAt: new Date().toISOString(),
      lastPeriodKey: options.periodKey ?? stored.lastPeriodKey ?? null,
      lastStatus: "sent",
      lastMessage: digest.title
    });
    return { sent: true, skipped: false, digest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveStoredSettings({
      ...stored,
      lastSentAt: new Date().toISOString(),
      lastStatus: "failed",
      lastMessage: message.slice(0, 200)
    });
    throw createError({ statusCode: 502, statusMessage: `推送发送失败：${message}` });
  }
}

class PushNotificationRunner {
  private started = false;
  private stopped = false;
  private working = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.schedule(60_000);
  }

  private schedule(delay = 15 * 60 * 1000) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private async tick() {
    if (this.working || this.stopped) return this.schedule();
    this.working = true;
    try {
      const stored = parseStoredSettings();
      if (!stored.enabled || !stored.webhookUrlEncrypted) return;
      const schedule = normalizeSchedule(stored.schedule);
      const weekday = clampInteger(stored.weekday, 1, 0, 6);
      const sendHour = clampInteger(stored.sendHour, 9, 0, 23);
      const periodKey = computeSchedulePeriodKey(new Date(), schedule, weekday, sendHour);
      if (!periodKey || stored.lastPeriodKey === periodKey) return;
      await sendPushDigestNow({ scheduled: true, periodKey });
    } catch (error) {
      await writeLog("warn", "Scheduled push digest failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.working = false;
      this.schedule();
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const pushNotificationRunner = new PushNotificationRunner();
