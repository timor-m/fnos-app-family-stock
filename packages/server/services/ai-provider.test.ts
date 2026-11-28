import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekProvider,
  buildAiExtractionUserPrompt,
  createAiProvider,
  validateAiExtractionContent,
  type AiExtractionRequest
} from "./ai-provider.ts";

const request: AiExtractionRequest = {
  intakeId: "intake-test",
  basedOnVersion: 2,
  categories: [
    { key: "food", name: "食品饮料", enabledFields: ["productionDate", "shelfLife"] },
    { key: "tool", name: "工具设备", enabledFields: ["model"] }
  ],
  currentCategoryKey: null,
  resolvedFields: [],
  unresolvedFields: ["categoryKey", "name", "shelfLife"],
  lines: [
    { id: "image-1:line-1", text: "纯牛奶", confidence: 0.96, imageId: "image-1", imageRole: "product" },
    { id: "image-2:line-2", text: "保质期6个月", confidence: 0.92, imageId: "image-2", imageRole: "label" }
  ]
};

test("validates strict DeepSeek extraction output", () => {
  const result = validateAiExtractionContent(JSON.stringify({
    fields: [
      { fieldKey: "categoryKey", value: "food", confidence: 0.94, sourceLineIds: ["image-1:line-1"] },
      { fieldKey: "name", value: "纯牛奶", confidence: 0.96, sourceLineIds: ["image-1:line-1"] },
      { fieldKey: "shelfLife", value: { value: 6, unit: "month" }, confidence: 0.92, sourceLineIds: ["image-2:line-2"] }
    ]
  }), request);
  assert.equal(result.length, 3);
  assert.equal(result[0].confidence, 0.89);
  assert.deepEqual(result[2].value, { value: 6, unit: "month" });
});

test("accepts compact AI output without OCR line ids", () => {
  const result = validateAiExtractionContent(JSON.stringify({
    fields: [
      { fieldKey: "name", value: "纯牛奶", confidence: 0.96 },
      { fieldKey: "shelfLife", value: { value: 6, unit: "month" }, confidence: 0.92 }
    ]
  }), request);
  assert.deepEqual(result[0].sourceLineIds, ["image-1:line-1"]);
  assert.deepEqual(result[1].sourceLineIds, ["image-2:line-2"]);
});

test("allows unknown fields to return null without a candidate", () => {
  const result = validateAiExtractionContent(JSON.stringify({
    fields: [{ fieldKey: "name", value: null }]
  }), request);
  assert.deepEqual(result, []);
});

test("rejects extra keys and fabricated OCR evidence", () => {
  assert.throws(() => validateAiExtractionContent(JSON.stringify({
    fields: [{ fieldKey: "name", value: "纯牛奶", confidence: 0.9, sourceLineIds: ["missing"], reason: "guess" }]
  }), request), /未允许的字段/);
});

test("rejects categories outside the configured templates", () => {
  assert.throws(() => validateAiExtractionContent(JSON.stringify({
    fields: [{ fieldKey: "categoryKey", value: "unknown", confidence: 0.8, sourceLineIds: ["image-1:line-1"] }]
  }), request), /品类不在允许范围/);
});

test("normalizes Chinese category names to category keys", () => {
  const result = validateAiExtractionContent(JSON.stringify({
    fields: [{ fieldKey: "categoryKey", value: "食品饮料", confidence: 0.8, sourceLineIds: ["image-1:line-1"] }]
  }), request);

  assert.equal(result[0].value, "food");
});

test("builds compact OCR prompt grouped by image role", () => {
  const prompt = buildAiExtractionUserPrompt({
    ...request,
    lines: [
      { id: "image-1:line-1", text: "方树叶*99%*", confidence: 0.99, imageId: "image-1", imageRole: "product" },
      { id: "image-1:line-2", text: "方树叶*99%*", confidence: 0.99, imageId: "image-1", imageRole: "product" },
      { id: "image-2:line-1", text: "产品名称：东方树叶茉莉花茶原味茶饮料保质期：*100%*", confidence: 1, imageId: "image-2", imageRole: "label" },
      { id: "image-3:line-1", text: "20251231 113233 HY6b*95%*", confidence: 0.95, imageId: "image-3", imageRole: "date" }
    ]
  });
  assert.match(prompt, /### 商品主体文案\n方树叶/);
  assert.match(prompt, /### 商品配料表与标签文案[\s\S]*产品名称：东方树叶茉莉花茶原味茶饮料保质期：/);
  assert.match(prompt, /### 商品生产日期\/到期日期文案[\s\S]*20251231 113233 HY6b/);
  assert.equal(prompt.includes("image-1:line-1"), false);
  assert.equal((prompt.match(/\n方树叶\n/g) || []).length, 1);
});

test("does not retry non-retryable DeepSeek authentication failures", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "invalid key" } }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const provider = new DeepSeekProvider({
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      apiKey: "test",
      model: "deepseek-chat",
      timeoutSeconds: 5,
      maxRetries: 3
    });
    await assert.rejects(provider.testConnection(), /invalid key/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries invalid structured output at most once", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"fields":"invalid"}' } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new DeepSeekProvider({
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      apiKey: "test",
      model: "deepseek-chat",
      timeoutSeconds: 5,
      maxRetries: 3
    });
    await assert.rejects(provider.extract(request), /根对象只能包含 fields 数组/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends compact OCR text prompt to AI extraction", async () => {
  const originalFetch = globalThis.fetch;
  let userContent = "";
  globalThis.fetch = async (_url, init) => {
    const requestBody = JSON.parse(String(init?.body || "{}")) as { messages?: Array<{ role: string; content: string }> };
    userContent = requestBody.messages?.find((message) => message.role === "user")?.content || "";
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        fields: [
          { fieldKey: "name", value: "纯牛奶", confidence: 0.96 },
          { fieldKey: "shelfLife", value: { value: 6, unit: "month" }, confidence: 0.92 }
        ]
      }) } }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new DeepSeekProvider({
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      apiKey: "test",
      model: "deepseek-chat",
      timeoutSeconds: 5,
      maxRetries: 0
    });
    const result = await provider.extract(request);
    assert.equal(result.candidates.length, 2);
    assert.match(userContent, /### 商品主体文案/);
    assert.equal(userContent.includes("ocrLines"), false);
    assert.equal(userContent.includes("ocrTextByImage"), false);
    assert.equal(userContent.includes("image-1:line-1"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts reachable DeepSeek test response with empty content as a warning", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "" } }],
      usage: { total_tokens: 3 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new DeepSeekProvider({
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      apiKey: "test",
      model: "deepseek-chat",
      timeoutSeconds: 5,
      maxRetries: 0
    });
    const result = await provider.testConnection();
    assert.equal(result.usage.totalTokens, 3);
    assert.match(result.warning || "", /回复内容为空/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tests DeepSeek connection without JSON output mode", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "pong" } }],
      usage: { total_tokens: 2 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = new DeepSeekProvider({
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      apiKey: "test",
      model: "deepseek-chat",
      timeoutSeconds: 5,
      maxRetries: 0
    });
    const usage = await provider.testConnection();
    assert.equal(requestBody?.response_format, undefined);
    assert.equal(requestBody?.temperature, 0);
    assert.equal(usage.usage.totalTokens, 2);
    assert.equal(usage.warning, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses Kimi-compatible default temperature", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { content: "OK" } }],
      usage: { total_tokens: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const provider = createAiProvider({
      provider: "kimi",
      baseUrl: "https://api.moonshot.ai/v1",
      apiKey: "test",
      model: "kimi-k3",
      timeoutSeconds: 5,
      maxRetries: 0
    });
    const usage = await provider.testConnection();
    assert.equal(requestBody?.temperature, 1);
    assert.equal(usage.usage.totalTokens, 1);
    assert.equal(usage.warning, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates OpenAI-compatible providers beyond DeepSeek", async () => {
  const provider = createAiProvider({
    provider: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "test",
    model: "qwen-plus",
    timeoutSeconds: 5,
    maxRetries: 0
  });
  assert.equal(typeof provider.extract, "function");
  assert.equal(typeof provider.testConnection, "function");
});

test("custom gateways and keyless Ollama use the selected endpoint and model", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    for (const provider of ["custom", "ollama"] as const) {
      await createAiProvider({ provider, baseUrl: "http://localhost:11434/v1", model: "my-local-model", apiKey: "", timeoutSeconds: 600, maxRetries: 0 }).testConnection();
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "http://localhost:11434/v1/chat/completions");
    assert.equal(new Headers(calls[1].init.headers).has("authorization"), false);
    assert.equal(JSON.parse(String(calls[1].init.body)).model, "my-local-model");
  } finally { globalThis.fetch = originalFetch; }
});

test("custom headers reach connection tests and extraction with case-insensitive overrides", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Headers[] = [];
  globalThis.fetch = async (_url, options) => {
    seen.push(new Headers(options?.headers));
    return new Response(JSON.stringify({choices:[{message:{content: seen.length === 1 ? 'OK' : '{"fields":[]}'}}]}));
  };
  try {
    const provider = createAiProvider({provider:'custom',baseUrl:'https://example.invalid',apiKey:'default',model:'model',timeoutSeconds:5,maxRetries:0,headers:[{name:'Authorization',value:'Custom auth'},{name:'x-project',value:'project'}]});
    await provider.testConnection(); await provider.extract(request);
    assert.equal(seen.length, 2);
    for (const headers of seen) { assert.equal(headers.get('authorization'),'Custom auth'); assert.equal(headers.get('x-project'),'project'); assert.equal(headers.get('content-type'),'application/json'); }
  } finally { globalThis.fetch = originalFetch; }
});
