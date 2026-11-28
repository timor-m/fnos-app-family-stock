import { createError } from "h3";
import { getDatabase } from "../database/client";
import { createId } from "../utils/identifier";
import { getAppConfig } from "../utils/runtime-config";
import {
  aiProviderCatalog,
  aiRequestHeaders,
  isAiConfigured,
  createAiProvider,
  normalizeAiProvider,
  type AiProviderConfig,
  type AiProviderKey
} from "./ai-provider";
import { decryptAiSecret, encryptAiSecret } from "./ai-secret.service";

type Connection = AiProviderConfig & { id: string; name: string };
const settingKey = "ai.extraction";

type StoredProviderSettings = {
  baseUrl?: string;
  apiKeyEncrypted?: string;
  headers?: Array<{ name: string; value?: string; valueEncrypted?: string }>;
  apiKey?: string;
  model?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
};

type StoredAiSettings = StoredProviderSettings & {
  enabled?: boolean;
  provider?: string;
  profiles?: Array<StoredProviderSettings & { id: string; name: string; provider: string }>;
  defaultProfileId?: string;
  providers?: Partial<Record<AiProviderKey, StoredProviderSettings>>;
};

type ParsedProviderSettings = Omit<StoredProviderSettings, "apiKeyEncrypted" | "headers"> & {
  headers?: Array<{ name: string; value: string }>;
  apiKey?: string;
};

type ParsedAiSettings = {
  profiles?: Connection[];
  defaultProfileId?: string;
  enabled?: boolean;
  provider?: string;
  providers: Partial<Record<AiProviderKey, ParsedProviderSettings>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decryptProviderSettings(settings: StoredProviderSettings | undefined) {
  if (!settings) return undefined;
  const parsed: ParsedProviderSettings = {
    headers: (settings.headers || []).map(header => ({ name: header.name, value: header.valueEncrypted ? decryptAiSecret(header.valueEncrypted) : header.value || "" })),
    baseUrl: settings.baseUrl,
    model: settings.model,
    timeoutSeconds: settings.timeoutSeconds,
    maxRetries: settings.maxRetries
  };
  if (settings.apiKeyEncrypted) {
    parsed.apiKey = decryptAiSecret(settings.apiKeyEncrypted);
  } else if (typeof settings.apiKey === "string") {
    parsed.apiKey = settings.apiKey;
  }
  return parsed;
}

function mergeProviderSettings(
  base: ParsedProviderSettings | undefined,
  fallback: ParsedProviderSettings | undefined
) {
  if (!fallback) return base;
  return {
    ...fallback,
    ...base,
    apiKey: base?.apiKey ?? fallback.apiKey
  };
}

function serializeSettings(settings: ParsedAiSettings) {
  return {
    enabled: settings.enabled === true,
    defaultProfileId: settings.defaultProfileId || "",
    profiles: (settings.profiles || []).map(({ apiKey, headers, ...profile }) => ({ ...profile, apiKeyEncrypted: encryptAiSecret(apiKey), headers: (headers || []).map(header => ({ name: header.name, valueEncrypted: encryptAiSecret(header.value) })) }))
  };
}

function saveStoredSettings(settings: ParsedAiSettings) {
  getDatabase().prepare(`
    INSERT INTO app_settings (setting_key, value_json)
    VALUES (?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(settingKey, JSON.stringify(serializeSettings(settings)));
}

function parseStoredSettings(): ParsedAiSettings {
  const db = getDatabase();
  const row = db.prepare("SELECT value_json AS valueJson FROM app_settings WHERE setting_key = ?")
    .get(settingKey) as { valueJson: string } | undefined;
  if (!row) return { providers: {} };
  try {
    const stored = JSON.parse(row.valueJson) as StoredAiSettings;
    const provider = normalizeAiProvider(stored.provider);
    const providers: ParsedAiSettings["providers"] = {};

    if (isRecord(stored.providers)) {
      for (const key of Object.keys(aiProviderCatalog) as AiProviderKey[]) {
        const raw = stored.providers[key];
        if (isRecord(raw)) {
          providers[key] = decryptProviderSettings(raw as StoredProviderSettings);
        }
      }
    }

    const legacyConfig = decryptProviderSettings(stored);
    if (
      legacyConfig &&
      (stored.baseUrl || stored.model || stored.apiKey || stored.apiKeyEncrypted)
    ) {
      providers[provider] = mergeProviderSettings(providers[provider], legacyConfig);
    }

    return {
      enabled: stored.enabled,
      profiles: Array.isArray(stored.profiles) ? stored.profiles.map(profile => ({
        ...decryptProviderSettings(profile), id: profile.id, name: profile.name,
        provider: normalizeAiProvider(profile.provider)
      })) as Connection[] : undefined,
      defaultProfileId: stored.defaultProfileId,
      provider,
      providers
    };
  } catch {
    return { providers: {} };
  }
}

function normalizeBaseUrl(value: unknown) {
  const baseUrl = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw createError({ statusCode: 400, statusMessage: "AI API 地址无效" });
  }
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function runtimeProviderConfig(provider: AiProviderKey) {
  const runtime = getAppConfig();
  const defaults = aiProviderCatalog[provider];
  const runtimeProvider = normalizeAiProvider(runtime.aiProvider);
  const isRuntimeProvider = provider === runtimeProvider;
  const isDeepSeek = provider === "deepseek";
  return {
    baseUrl: (isRuntimeProvider && runtime.aiApiBase) || (isDeepSeek ? runtime.deepseekApiBase : defaults.defaultBaseUrl),
    apiKey: (isRuntimeProvider && runtime.aiApiKey) || (isDeepSeek ? runtime.deepseekApiKey : ""),
    model: (isRuntimeProvider && runtime.aiModel) || (isDeepSeek ? runtime.deepseekModel : defaults.defaultModel),
    timeoutSeconds: runtime.aiTimeoutSeconds,
    maxRetries: runtime.aiMaxRetries
  };
}

function resolveProviderConfig(provider: AiProviderKey, stored: ParsedAiSettings): AiProviderConfig {
  const defaults = aiProviderCatalog[provider];
  const runtimeConfig = runtimeProviderConfig(provider);
  const providerConfig = stored.providers[provider] || {};
  return {
    provider,
    baseUrl: providerConfig.baseUrl || runtimeConfig.baseUrl || defaults.defaultBaseUrl,
    apiKey: providerConfig.apiKey ?? runtimeConfig.apiKey,
    headers: providerConfig.headers || [],
    model: providerConfig.model || runtimeConfig.model || defaults.defaultModel,
    timeoutSeconds: clampInteger(providerConfig.timeoutSeconds, runtimeConfig.timeoutSeconds, 5, 3600),
    maxRetries: clampInteger(providerConfig.maxRetries, runtimeConfig.maxRetries, 0, 3)
  };
}

function connections(stored: ParsedAiSettings): Connection[] {
  if (stored.profiles) return stored.profiles;
  const keys = Object.keys(stored.providers) as AiProviderKey[];
  if (!keys.length) {
    const provider = normalizeAiProvider(stored.provider || getAppConfig().aiProvider);
    const config = resolveProviderConfig(provider, stored);
    return config.apiKey ? [{ ...config, id: `legacy-${provider}`, name: aiProviderCatalog[provider].label }] : [];
  }
  return keys.map(provider => ({ ...resolveProviderConfig(provider, stored), id: `legacy-${provider}`, name: aiProviderCatalog[provider].label }));
}
function defaultConnection(stored: ParsedAiSettings) {
  const profiles = connections(stored);
  return profiles.find(p => p.id === stored.defaultProfileId) || profiles.find(p => p.provider === stored.provider) || profiles[0];
}
export function getResolvedAiSettings(): AiProviderConfig & { enabled: boolean } {
  const stored = parseStoredSettings();
  const profile = defaultConnection(stored);
  return { ...(profile || { provider: "custom", baseUrl: "", model: "", apiKey: "", timeoutSeconds: 30, maxRetries: 1 }), enabled: Boolean(profile) && (stored.enabled ?? getAppConfig().aiEnabled) };
}

function maskApiKey(apiKey: string) {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "••••••••";
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}

export function getAiStatistics() {
  const row = getDatabase().prepare(`
    SELECT
      COUNT(*) AS totalCalls,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successfulCalls,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCalls,
      SUM(COALESCE(total_tokens, 0)) AS totalTokens
    FROM ai_extraction_runs
    WHERE created_at >= datetime('now', 'start of month')
  `).get() as {
    totalCalls: number;
    successfulCalls: number | null;
    failedCalls: number | null;
    totalTokens: number | null;
  };
  return {
    totalCalls: Number(row.totalCalls || 0),
    successfulCalls: Number(row.successfulCalls || 0),
    failedCalls: Number(row.failedCalls || 0),
    totalTokens: Number(row.totalTokens || 0)
  };
}

export function getPublicAiSettings() {
  const stored = parseStoredSettings();
  const settings = getResolvedAiSettings();
  return {
    ...settings, apiKey: undefined, headers: undefined,
    apiKeyConfigured: Boolean(settings.apiKey),
    configured: isAiConfigured(settings),
    defaultProfileId: defaultConnection(stored)?.id || "",
    profiles: connections(stored).map(({ apiKey, headers, ...profile }) => ({ ...profile, headers: (headers || []).map(header => ({ name: header.name, value: "", configured: true })), apiKeyConfigured: Boolean(apiKey), apiKeyMasked: maskApiKey(apiKey) })),
    providers: Object.entries(aiProviderCatalog).map(([key, value]) => ({ key, ...value })),
    statistics: getAiStatistics()
  };
}

function inputHeaders(value: unknown, existing: Connection | undefined, canKeep: boolean): NonNullable<AiProviderConfig["headers"]> {
  if (value === undefined) return canKeep ? existing?.headers || [] : [];
  if (!Array.isArray(value) || value.length > 32) throw createError({ statusCode: 400, statusMessage: "扩展请求头最多支持 32 组" });
  const names = new Set<string>();
  return value.flatMap(raw => {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.value !== "string") throw createError({ statusCode: 400, statusMessage: "扩展请求头格式无效" });
    const name = raw.name.trim();
    if (!name && !raw.value) return [];
    const key = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || name.length > 128 || names.has(key)) throw createError({ statusCode: 400, statusMessage: "请求头名称无效或重复" });
    if (["host", "content-length", "connection", "transfer-encoding", "upgrade", "cookie", "set-cookie"].includes(key)) throw createError({ statusCode: 400, statusMessage: "此请求头由系统管理，不能自定义" });
    names.add(key);
    const previous = canKeep ? existing?.headers?.find(header => header.name.toLowerCase() === key)?.value : undefined;
    const headerValue = raw.value || previous || "";
    if (!headerValue || headerValue.length > 8192 || /[^\t\x20-\x7e\x80-\xff]/.test(headerValue)) throw createError({ statusCode: 400, statusMessage: "请填写有效的请求头值；更换地址、服务商或名称后需重新填写" });
    return [{ name, value: headerValue }];
  });
}

function inputConnection(body: Record<string, unknown>, existing?: Connection): Connection {
  if (typeof body.provider !== "string" || !Object.hasOwn(aiProviderCatalog, body.provider)) throw createError({ statusCode: 400, statusMessage: "请选择有效服务商" });
  const provider = body.provider as AiProviderKey;
  const baseUrl = normalizeBaseUrl(body.baseUrl);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!name || name.length > 80 || !model || model.length > 100) throw createError({ statusCode: 400, statusMessage: "请填写连接名称（80 字以内）与模型 ID（100 字以内）" });
  const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  // A changed endpoint/provider must never silently receive another connection's saved secret.
  const canKeepKey = existing?.baseUrl === baseUrl && existing.provider === provider;
  const apiKey = body.clearApiKey === true ? "" : key || (canKeepKey ? existing?.apiKey || "" : "");
  return { id: existing?.id || createId("ai-connection"), name, provider, baseUrl, model, apiKey, headers: inputHeaders(body.headers, existing, canKeepKey),
    timeoutSeconds: clampInteger(body.timeoutSeconds, 30, 5, 3600), maxRetries: clampInteger(body.maxRetries, 1, 0, 3) };
}

export function updateAiSettings(body: Record<string, unknown>) {
  const stored = parseStoredSettings();
  if (!Array.isArray(body.profiles)) throw createError({ statusCode: 400, statusMessage: "连接配置格式无效" });
  const existing = connections(stored);
  const ids = new Set<string>();
  const profiles = body.profiles.map(raw => {
    if (!isRecord(raw)) throw createError({ statusCode: 400, statusMessage: "连接配置格式无效" });
    const old = typeof raw.id === "string" ? existing.find(p => p.id === raw.id) : undefined;
    if (raw.id && !old && !(typeof raw.id === "string" && /^new-[a-zA-Z0-9-]+$/.test(raw.id))) throw createError({ statusCode: 400, statusMessage: "连接不存在，请刷新后重试" });
    const profile = inputConnection(raw, old);
    if (!old && typeof raw.id === "string") profile.id = raw.id;
    if (ids.has(profile.id)) throw createError({ statusCode: 400, statusMessage: "连接 ID 重复" });
    ids.add(profile.id); return profile;
  });
  const defaultProfileId = typeof body.defaultProfileId === "string" ? body.defaultProfileId : "";
  if (profiles.length && !profiles.some(p => p.id === defaultProfileId)) throw createError({ statusCode: 400, statusMessage: "请选择默认连接" });
  const selected = profiles.find(p => p.id === defaultProfileId);
  if (body.enabled === true && (!selected || !isAiConfigured(selected))) throw createError({ statusCode: 400, statusMessage: "请先为默认连接配置 API Key、扩展请求头，或使用本地 Ollama" });
  saveStoredSettings({ enabled: body.enabled === true, profiles, defaultProfileId, providers: {} });
  return getPublicAiSettings();
}

function previewConnection(body: Record<string, unknown>) {
  const stored = parseStoredSettings();
  const existing = typeof body.id === "string" ? connections(stored).find(p => p.id === body.id) : undefined;
  return inputConnection({ ...body, name: body.name || "连接测试", model: body.model || "model-list" }, existing);
}

export async function listAiModels(body: Record<string, unknown>) {
  const config = previewConnection(body);
  if (!isAiConfigured(config)) throw createError({ statusCode: 400, statusMessage: "请填写 API Key 或扩展鉴权请求头" });
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: aiRequestHeaders(config),
      signal: AbortSignal.timeout(30000), redirect: "error"
    });
    if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}），可手动填写模型 ID`);
    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(payload.data)) throw new Error("服务未返回兼容的模型列表，请手动填写模型 ID");
    return { models: [...new Set(payload.data.map(m => m.id).filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].sort() };
  } catch (err) { throw createError({ statusCode: 502, statusMessage: err instanceof Error ? err.message : "模型列表加载失败" }); }
}

function aiTestStatusCode(code: string) {
  if (code === "AI_TIMEOUT") return 504;
  if (!code.startsWith("HTTP_")) return 502;
  const upstreamStatus = Number(code.slice(5));
  if ([400, 401, 403, 404, 429].includes(upstreamStatus)) return upstreamStatus;
  if (upstreamStatus >= 500) return 502;
  return 502;
}

export async function testAiConnection(body: Record<string, unknown> = {}) {
  const config = previewConnection(body);
  if (!body.model || typeof body.model !== "string" || !body.model.trim()) throw createError({ statusCode: 400, statusMessage: "请填写模型 ID" });
  if (!isAiConfigured(config)) throw createError({ statusCode: 400, statusMessage: "请填写 API Key 或扩展鉴权请求头" });

  const runId = createId("ai-run");
  const db = getDatabase();
  db.prepare(`
    INSERT INTO ai_extraction_runs (id, purpose, provider, model, status, started_at)
    VALUES (?, 'connection_test', ?, ?, 'processing', CURRENT_TIMESTAMP)
  `).run(runId, config.provider, config.model);
  const startedAt = Date.now();
  try {
    const result = await createAiProvider(config).testConnection();
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'completed', prompt_tokens = ?, completion_tokens = ?, total_tokens = ?,
          elapsed_ms = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      result.usage.promptTokens,
      result.usage.completionTokens,
      result.usage.totalTokens,
      Date.now() - startedAt,
      runId
    );
    return {
      connected: true,
      provider: config.provider,
      model: config.model,
      elapsedMs: Date.now() - startedAt,
      warning: result.warning
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && "code" in error ? String((error as Error & { code?: string }).code || "AI_TEST_FAILED") : "AI_TEST_FAILED";
    db.prepare(`
      UPDATE ai_extraction_runs
      SET status = 'failed', error_code = ?, error_message = ?, elapsed_ms = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(code, message.slice(0, 500), Date.now() - startedAt, runId);
    throw createError({ statusCode: aiTestStatusCode(code), statusMessage: message });
  }
}
