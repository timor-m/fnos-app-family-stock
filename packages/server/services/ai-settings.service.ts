import { createError } from "h3";
import { getDatabase } from "../database/client";
import { createId } from "../utils/identifier";
import { getAppConfig } from "../utils/runtime-config";
import {
  aiProviderCatalog,
  createAiProvider,
  normalizeAiProvider,
  type AiProviderConfig,
  type AiProviderKey
} from "./ai-provider";
import { decryptAiSecret, encryptAiSecret } from "./ai-secret.service";

const settingKey = "ai.extraction";

type StoredProviderSettings = {
  baseUrl?: string;
  apiKeyEncrypted?: string;
  apiKey?: string;
  model?: string;
  timeoutSeconds?: number;
  maxRetries?: number;
};

type StoredAiSettings = StoredProviderSettings & {
  enabled?: boolean;
  provider?: string;
  providers?: Partial<Record<AiProviderKey, StoredProviderSettings>>;
};

type ParsedProviderSettings = Omit<StoredProviderSettings, "apiKeyEncrypted"> & {
  apiKey?: string;
};

type ParsedAiSettings = {
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
  const providers: Partial<Record<AiProviderKey, StoredProviderSettings>> = {};
  for (const provider of Object.keys(aiProviderCatalog) as AiProviderKey[]) {
    const config = settings.providers[provider];
    if (!config) continue;
    providers[provider] = {
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutSeconds: config.timeoutSeconds,
      maxRetries: config.maxRetries,
      apiKeyEncrypted: encryptAiSecret(config.apiKey || "")
    };
  }
  return {
    enabled: settings.enabled === true,
    provider: normalizeAiProvider(settings.provider),
    providers
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
    model: providerConfig.model || runtimeConfig.model || defaults.defaultModel,
    timeoutSeconds: clampInteger(providerConfig.timeoutSeconds, runtimeConfig.timeoutSeconds, 5, 120),
    maxRetries: clampInteger(providerConfig.maxRetries, runtimeConfig.maxRetries, 0, 3)
  };
}

export function getResolvedAiSettings(): AiProviderConfig & { enabled: boolean } {
  const runtime = getAppConfig();
  const stored = parseStoredSettings();
  const provider = normalizeAiProvider(stored.provider || runtime.aiProvider);
  return {
    enabled: stored.enabled ?? runtime.aiEnabled,
    ...resolveProviderConfig(provider, stored)
  };
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
  const runtime = getAppConfig();
  const stored = parseStoredSettings();
  const provider = normalizeAiProvider(stored.provider || runtime.aiProvider);
  const settings = {
    enabled: stored.enabled ?? runtime.aiEnabled,
    ...resolveProviderConfig(provider, stored)
  };
  const providerSettings = Object.fromEntries(
    (Object.keys(aiProviderCatalog) as AiProviderKey[]).map((key) => {
      const config = resolveProviderConfig(key, stored);
      return [
        key,
        {
          baseUrl: config.baseUrl,
          model: config.model,
          timeoutSeconds: config.timeoutSeconds,
          maxRetries: config.maxRetries,
          apiKeyConfigured: Boolean(config.apiKey),
          apiKeyMasked: maskApiKey(config.apiKey)
        }
      ];
    })
  );
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    timeoutSeconds: settings.timeoutSeconds,
    maxRetries: settings.maxRetries,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiKeyMasked: maskApiKey(settings.apiKey),
    providerSettings,
    providers: Object.entries(aiProviderCatalog).map(([key, value]) => ({
      key,
      label: value.label,
      defaultBaseUrl: value.defaultBaseUrl,
      defaultModel: value.defaultModel
    })),
    statistics: getAiStatistics()
  };
}

export function updateAiSettings(body: Record<string, unknown>) {
  const runtime = getAppConfig();
  const stored = parseStoredSettings();
  const provider = normalizeAiProvider(body.provider || stored.provider || runtime.aiProvider);
  const defaults = aiProviderCatalog[provider];
  const current = resolveProviderConfig(provider, stored);
  const submittedKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const apiKey = body.clearApiKey === true ? "" : submittedKey || current.apiKey;
  const model = typeof body.model === "string" && body.model.trim()
    ? body.model.trim()
    : current.model || defaults.defaultModel;
  if (!model || model.length > 100) {
    throw createError({ statusCode: 400, statusMessage: "模型名称不能为空且不能超过 100 个字符" });
  }
  if (body.enabled === true && !apiKey) {
    throw createError({ statusCode: 400, statusMessage: `启用 AI 前需要填写 ${defaults.label} API Key` });
  }
  const next: ParsedAiSettings = {
    enabled: body.enabled === true,
    provider,
    providers: {
      ...stored.providers,
      [provider]: {
        baseUrl: normalizeBaseUrl(body.baseUrl ?? current.baseUrl),
        apiKey,
        model,
        timeoutSeconds: clampInteger(body.timeoutSeconds, current.timeoutSeconds, 5, 120),
        maxRetries: clampInteger(body.maxRetries, current.maxRetries, 0, 3)
      }
    }
  };
  saveStoredSettings(next);
  return getPublicAiSettings();
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
  const runtime = getAppConfig();
  const stored = parseStoredSettings();
  const provider = normalizeAiProvider(body.provider || stored.provider || runtime.aiProvider);
  const defaults = aiProviderCatalog[provider];
  const current = resolveProviderConfig(provider, stored);
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim()
    ? body.apiKey.trim()
    : current.apiKey;
  const config: AiProviderConfig = {
    provider,
    baseUrl: normalizeBaseUrl(body.baseUrl ?? current.baseUrl),
    apiKey,
    model: typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : current.model || defaults.defaultModel,
    timeoutSeconds: clampInteger(body.timeoutSeconds, current.timeoutSeconds, 5, 120),
    maxRetries: clampInteger(body.maxRetries, current.maxRetries, 0, 3)
  };
  if (!config.apiKey) throw createError({ statusCode: 400, statusMessage: `请先填写 ${defaults.label} API Key` });

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
