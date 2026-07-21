export type AiProviderKey = "deepseek" | "kimi" | "glm" | "qwen";

export type AiProviderConfig = {
  provider: AiProviderKey;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutSeconds: number;
  maxRetries: number;
};

export const aiProviderCatalog: Record<AiProviderKey, { label: string; defaultBaseUrl: string; defaultModel: string }> = {
  deepseek: {
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat"
  },
  kimi: {
    label: "Kimi",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k3"
  },
  glm: {
    label: "GLM",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-5.2"
  },
  qwen: {
    label: "Qwen",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus"
  }
};

export function normalizeAiProvider(value: unknown): AiProviderKey {
  return typeof value === "string" && value in aiProviderCatalog ? value as AiProviderKey : "deepseek";
}

function providerLabel(provider: AiProviderKey) {
  return aiProviderCatalog[provider].label;
}

function defaultTemperature(provider: AiProviderKey, model: string) {
  if (provider === "kimi" || /^kimi-/i.test(model.trim())) return 1;
  return 0;
}

export type AiOcrLine = {
  id: string;
  text: string;
  confidence: number;
  imageId: string;
  imageRole: string;
};

export type AiExtractionRequest = {
  intakeId: string;
  basedOnVersion: number;
  categories: Array<{ key: string; name: string; enabledFields: string[] }>;
  currentCategoryKey: string | null;
  resolvedFields: Array<{ fieldKey: string; value: unknown; source: string; confidence: number | null }>;
  unresolvedFields: string[];
  lines: AiOcrLine[];
};

export type AiFieldCandidate = {
  fieldKey: string;
  value: string | { value: number; unit: "day" | "month" | "year" };
  confidence: number;
  sourceLineIds: string[];
};

export type AiProviderResult = {
  candidates: AiFieldCandidate[];
  usage: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
};

export type AiConnectionTestResult = {
  usage: AiProviderResult["usage"];
  warning: string | null;
};

export interface AiExtractionProvider {
  extract(request: AiExtractionRequest): Promise<AiProviderResult>;
  testConnection(): Promise<AiConnectionTestResult>;
}

const stringLimits: Record<string, number> = {
  categoryKey: 40,
  name: 80,
  brand: 50,
  specification: 60,
  ingredients: 2000,
  productionDate: 10,
  expirationDate: 10
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed) as unknown;
}

function compactText(value: string) {
  return value
    .replace(/\*\d{1,3}%\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactOcrLines(lines: AiOcrLine[], role: string, limit = 40) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    if (line.imageRole !== role) continue;
    const text = compactText(line.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

export function buildAiExtractionUserPrompt(request: AiExtractionRequest) {
  const productLines = compactOcrLines(request.lines, "product", 24);
  const labelLines = compactOcrLines(request.lines, "label", 50);
  const dateLines = compactOcrLines(request.lines, "date", 16);
  const unknownLines = request.lines
    .filter((line) => !["product", "label", "date"].includes(line.imageRole))
    .map((line) => compactText(line.text))
    .filter(Boolean)
    .slice(0, 16);

  return [
    "请只依据下面 OCR 文本提取家庭库存入库字段；不要猜测 OCR 中不存在的信息。",
    "",
    "可选品类 JSON：",
    JSON.stringify(request.categories),
    "",
    `当前品类：${request.currentCategoryKey || "未确定"}`,
    "",
    "已有可信字段 JSON：",
    JSON.stringify(request.resolvedFields),
    "",
    "本次需要提取字段 JSON：",
    JSON.stringify(request.unresolvedFields),
    "",
    "### 商品主体文案",
    productLines.length ? productLines.join("\n") : "无",
    "",
    "### 商品配料表与标签文案（可能含产品名称、保质期、配料、品牌、规格）",
    labelLines.length ? labelLines.join("\n") : "无",
    "",
    "### 商品生产日期/到期日期文案（可能是喷码或批号）",
    dateLines.length ? dateLines.join("\n") : "无",
    ...(unknownLines.length ? ["", "### 其他 OCR 文案", unknownLines.join("\n")] : [])
  ].join("\n");
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

function dateDigits(value: string) {
  return value.replace(/\D/g, "");
}

function inferSourceLineIds(fieldKey: string, value: AiFieldCandidate["value"], lines: AiOcrLine[]) {
  if (!lines.length) return [];
  if (fieldKey === "shelfLife" && typeof value === "object") {
    const unitText: Record<string, string[]> = {
      day: ["天", "日", "day"],
      month: ["个月", "月", "month"],
      year: ["年", "year"]
    };
    return lines
      .filter((line) => {
        const text = normalizedText(line.text);
        return text.includes(String(value.value)) && (unitText[value.unit] || []).some((unit) => text.includes(normalizedText(unit)));
      })
      .slice(0, 3)
      .map((line) => line.id);
  }

  if (typeof value !== "string") return [];
  const normalizedValue = normalizedText(value);
  const normalizedDate = ["productionDate", "expirationDate"].includes(fieldKey) ? dateDigits(value) : "";
  return lines
    .filter((line) => {
      const text = normalizedText(line.text);
      if (normalizedValue && (text.includes(normalizedValue) || normalizedValue.includes(text))) return true;
      return Boolean(normalizedDate && dateDigits(line.text).includes(normalizedDate));
    })
    .slice(0, 3)
    .map((line) => line.id);
}

export function validateAiExtractionContent(content: string, request: AiExtractionRequest) {
  const parsed = parseJsonContent(content);
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "fields") || !Array.isArray(parsed.fields)) {
    throw new Error("AI 返回结构无效：根对象只能包含 fields 数组");
  }

  const allowedFields = new Set(request.unresolvedFields);
  const allowedLineIds = new Set(request.lines.map((line) => line.id));
  const allowedCategoryKeys = new Set(request.categories.map((category) => category.key));
  const candidates: AiFieldCandidate[] = [];
  const seenFields = new Set<string>();

  for (const raw of parsed.fields) {
    if (!isRecord(raw)) throw new Error("AI 返回结构无效：候选字段必须是对象");
    const keys = Object.keys(raw);
    if (keys.some((key) => !["fieldKey", "value", "confidence", "sourceLineIds"].includes(key))) {
      throw new Error("AI 返回结构无效：包含未允许的字段");
    }
    if (typeof raw.fieldKey !== "string" || !allowedFields.has(raw.fieldKey) || seenFields.has(raw.fieldKey)) {
      throw new Error("AI 返回结构无效：字段名称无效或重复");
    }
    if (raw.value === null) {
      seenFields.add(raw.fieldKey);
      continue;
    }
    if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
      throw new Error("AI 返回结构无效：置信度必须在 0 到 1 之间");
    }
    if (raw.sourceLineIds !== undefined && !Array.isArray(raw.sourceLineIds)) {
      throw new Error("AI 返回结构无效：sourceLineIds 必须是数组");
    }

    let value: AiFieldCandidate["value"];
    if (raw.fieldKey === "shelfLife") {
      if (
        !isRecord(raw.value) ||
        Object.keys(raw.value).some((key) => !["value", "unit"].includes(key)) ||
        !Number.isInteger(raw.value.value) ||
        Number(raw.value.value) <= 0 ||
        Number(raw.value.value) > 3650 ||
        !["day", "month", "year"].includes(String(raw.value.unit))
      ) {
        throw new Error("AI 返回结构无效：保质期格式错误");
      }
      value = {
        value: Number(raw.value.value),
        unit: raw.value.unit as "day" | "month" | "year"
      };
    } else {
      if (typeof raw.value !== "string") throw new Error("AI 返回结构无效：字段值必须是字符串");
      value = raw.value.trim();
      const limit = stringLimits[raw.fieldKey];
      if (!value || !limit || value.length > limit) throw new Error("AI 返回结构无效：字段值长度无效");
      if (raw.fieldKey === "categoryKey") {
        value = normalizeCategoryValue(value, request.categories);
        if (!allowedCategoryKeys.has(value)) {
          throw new Error("AI 返回结构无效：品类不在允许范围内");
        }
      }
      if (["productionDate", "expirationDate"].includes(raw.fieldKey) && !isValidDate(value)) {
        throw new Error("AI 返回结构无效：日期必须是有效的 YYYY-MM-DD");
      }
    }

    const rawSourceLineIds = Array.isArray(raw.sourceLineIds) ? raw.sourceLineIds : [];
    const sourceLineIds = rawSourceLineIds.filter(
      (lineId): lineId is string => typeof lineId === "string" && allowedLineIds.has(lineId)
    );
    if (sourceLineIds.length !== rawSourceLineIds.length) {
      throw new Error("AI 返回结构无效：包含不存在的 OCR 行");
    }

    candidates.push({
      fieldKey: raw.fieldKey,
      value,
      confidence: Math.min(0.89, raw.confidence),
      sourceLineIds: sourceLineIds.length ? sourceLineIds : inferSourceLineIds(raw.fieldKey, value, request.lines)
    });
    seenFields.add(raw.fieldKey);
  }
  return candidates;
}

function usageFromResponse(payload: Record<string, unknown>) {
  const usage = isRecord(payload.usage) ? payload.usage : {};
  return {
    promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null
  };
}

function normalizeCategoryValue(value: string, categories: AiExtractionRequest["categories"]) {
  if (categories.some((category) => category.key === value)) return value;
  const exactName = categories.find((category) => category.name === value);
  if (exactName) return exactName.key;
  const fuzzy = categories.filter((category) => category.name.includes(value) || value.includes(category.name));
  return fuzzy.length === 1 ? fuzzy[0].key : value;
}

export class OpenAiCompatibleProvider implements AiExtractionProvider {
  private readonly config: AiProviderConfig;

  constructor(config: AiProviderConfig) {
    this.config = config;
  }

  private async chat(body: Record<string, unknown>) {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutSeconds * 1000);
      try {
        const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            temperature: defaultTemperature(this.config.provider, this.config.model),
            ...body
          }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (!response.ok) {
          const apiError = isRecord(payload.error) && typeof payload.error.message === "string"
            ? payload.error.message
            : `${providerLabel(this.config.provider)} 请求失败 (${response.status})`;
          const error = new Error(apiError);
          (error as Error & { code?: string }).code = `HTTP_${response.status}`;
          if ((response.status === 429 || response.status >= 500) && attempt < this.config.maxRetries) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw error;
        }
        return payload;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (normalized.name === "AbortError") {
          const timeoutError = new Error(`${providerLabel(this.config.provider)} 请求超过 ${this.config.timeoutSeconds} 秒`);
          (timeoutError as Error & { code?: string }).code = "AI_TIMEOUT";
          lastError = timeoutError;
        } else {
          lastError = normalized;
        }
        const errorCode = "code" in normalized
          ? String((normalized as Error & { code?: string }).code || "")
          : "";
        const httpStatus = errorCode.startsWith("HTTP_") ? Number(errorCode.slice(5)) : null;
        if (httpStatus && httpStatus !== 429 && httpStatus < 500) throw lastError;
        if (attempt >= this.config.maxRetries) throw lastError;
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new Error(`${providerLabel(this.config.provider)} 请求失败`);
  }

  async extract(request: AiExtractionRequest): Promise<AiProviderResult> {
    const maxValidationRetries = Math.min(1, this.config.maxRetries);
    for (let validationAttempt = 0; validationAttempt <= maxValidationRetries; validationAttempt += 1) {
      const payload = await this.chat({
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是家庭库存商品信息提取器。只能依据提供的 OCR 文本提取，不允许猜测。",
              "只返回 JSON：{\"fields\":[{\"fieldKey\":...,\"value\":...,\"confidence\":0到1}]}。",
              "未知字段 value 返回 null；不得返回额外字段；日期统一 YYYY-MM-DD。",
              "categoryKey 必须返回 categories 中的 key，例如 food、medicine、daily、tool、digital、clothing、other；不要返回中文品类名。",
              "饮料、茶饮料、食品、零食、调味品通常归为 food；洗护清洁归为 daily；无法判断才返回 null。",
              "name 是商品正面主名称，优先依据“商品主体文案”的醒目标题；不要把净含量、容量、型号或规格单独当作商品名称。",
              "如果 OCR 中出现“产品名称：xxx”，通常 xxx 是最可靠的 name 依据；需去掉同一行后续的保质期、生产日期、标准号等字段。",
              "specification 只放净含量、容量、型号、尺寸等规格信息；brand 只放品牌，不要和商品名混在一起。",
              "ingredients 必须保持包装配料表的原始顺序，不得补写或改写成分。",
              "shelfLife 的 value 格式为 {\"value\":整数,\"unit\":\"day|month|year\"}。",
              "expirationDate 只提取包装明确标注的日期，不自行计算。"
            ].join("\n")
          },
          {
            role: "user",
            content: buildAiExtractionUserPrompt(request)
          }
        ]
      });
      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const first = isRecord(choices[0]) ? choices[0] : null;
      const message = first && isRecord(first.message) ? first.message : null;
      const content = message && typeof message.content === "string" ? message.content : "";
      try {
        if (!content) throw new Error(`${providerLabel(this.config.provider)} 未返回结构化内容`);
        return {
          candidates: validateAiExtractionContent(content, request),
          usage: usageFromResponse(payload)
        };
      } catch (error) {
        if (validationAttempt >= maxValidationRetries) throw error;
      }
    }
    throw new Error(`${providerLabel(this.config.provider)} 结构化输出校验失败`);
  }

  async testConnection() {
    const payload = await this.chat({
      max_tokens: 64,
      messages: [
        { role: "system", content: "你是连接测试助手。请只回复 OK 两个字母。" },
        { role: "user", content: "请回复 OK" }
      ]
    });
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = first && isRecord(first.message) ? first.message : null;
    const content = message && typeof message.content === "string" ? message.content : "";
    const usage = usageFromResponse(payload);
    if (!content.trim()) {
      return {
        usage,
        warning: `${providerLabel(this.config.provider)} API 已返回成功响应，但测试回复内容为空；如果后续结构化识别失败，请检查模型名称或上游代理。`
      };
    }
    return { usage, warning: null };
  }
}

export class DeepSeekProvider extends OpenAiCompatibleProvider {}

export function createAiProvider(config: AiProviderConfig): AiExtractionProvider {
  if (!(config.provider in aiProviderCatalog)) throw new Error(`不支持的 AI Provider：${config.provider}`);
  return new OpenAiCompatibleProvider(config);
}
