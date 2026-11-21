<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Bot, CheckCircle2, KeyRound, LoaderCircle, PlugZap, Save, TriangleAlert } from "@lucide/vue";
import FormSelect from "./form/FormSelect.vue";
import { request } from "../utils/api";

type Statistics = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalTokens: number;
};

type AiProviderKey = "deepseek" | "kimi" | "glm" | "qwen";
type AiProviderOption = {
  key: AiProviderKey;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
};
type ProviderSettings = {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  maxRetries: number;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
};

type AiSettings = {
  enabled: boolean;
  provider: AiProviderKey;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  maxRetries: number;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  providerSettings: Record<AiProviderKey, ProviderSettings>;
  providers: AiProviderOption[];
  statistics: Statistics;
};

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const message = ref<{ tone: "success" | "danger"; text: string } | null>(null);
const apiKey = ref("");
const settings = ref<AiSettings>({
  enabled: false,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  timeoutSeconds: 30,
  maxRetries: 1,
  apiKeyConfigured: false,
  apiKeyMasked: "",
  providerSettings: {
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      timeoutSeconds: 30,
      maxRetries: 1,
      apiKeyConfigured: false,
      apiKeyMasked: ""
    },
    kimi: {
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k3",
      timeoutSeconds: 30,
      maxRetries: 1,
      apiKeyConfigured: false,
      apiKeyMasked: ""
    },
    glm: {
      baseUrl: "https://api.z.ai/api/paas/v4",
      model: "glm-5.2",
      timeoutSeconds: 30,
      maxRetries: 1,
      apiKeyConfigured: false,
      apiKeyMasked: ""
    },
    qwen: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      timeoutSeconds: 30,
      maxRetries: 1,
      apiKeyConfigured: false,
      apiKeyMasked: ""
    }
  },
  providers: [
    { key: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat" },
    { key: "kimi", label: "Kimi", defaultBaseUrl: "https://api.moonshot.ai/v1", defaultModel: "kimi-k3" },
    { key: "glm", label: "GLM", defaultBaseUrl: "https://api.z.ai/api/paas/v4", defaultModel: "glm-5.2" },
    { key: "qwen", label: "Qwen", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" }
  ],
  statistics: { totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalTokens: 0 }
});

const currentProvider = computed(
  () => settings.value.providers.find((provider) => provider.key === settings.value.provider) || settings.value.providers[0]
);
const currentProviderSettings = computed(
  () => settings.value.providerSettings[settings.value.provider]
);

async function load() {
  loading.value = true;
  try {
    settings.value = await request<AiSettings>("ai/settings");
  } catch (error) {
    message.value = { tone: "danger", text: error instanceof Error ? error.message : "AI 配置加载失败" };
  } finally {
    loading.value = false;
  }
}

function body() {
  return {
    enabled: settings.value.enabled,
    provider: settings.value.provider,
    baseUrl: settings.value.baseUrl,
    model: settings.value.model,
    timeoutSeconds: settings.value.timeoutSeconds,
    maxRetries: settings.value.maxRetries,
    ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {})
  };
}

function changeProvider() {
  const provider = currentProvider.value;
  if (!provider) return;
  const providerSettings = settings.value.providerSettings[provider.key];
  settings.value.baseUrl = providerSettings?.baseUrl || provider.defaultBaseUrl;
  settings.value.model = providerSettings?.model || provider.defaultModel;
  settings.value.timeoutSeconds = providerSettings?.timeoutSeconds || 30;
  settings.value.maxRetries = providerSettings?.maxRetries ?? 1;
  settings.value.apiKeyConfigured = Boolean(providerSettings?.apiKeyConfigured);
  settings.value.apiKeyMasked = providerSettings?.apiKeyMasked || "";
  apiKey.value = "";
  message.value = settings.value.apiKeyConfigured
    ? { tone: "success", text: `已切换到 ${provider.label}，并载入该服务商已保存的配置。` }
    : { tone: "notice", text: `已切换到 ${provider.label}。该服务商还没有配置 API Key。` };
}

async function save() {
  saving.value = true;
  message.value = null;
  try {
    settings.value = await request<AiSettings>("ai/settings", { method: "PUT", body: JSON.stringify(body()) });
    apiKey.value = "";
    message.value = { tone: "success", text: "AI 配置已保存" };
  } catch (error) {
    message.value = { tone: "danger", text: error instanceof Error ? error.message : "AI 配置保存失败" };
  } finally {
    saving.value = false;
  }
}

async function testConnection() {
  testing.value = true;
  message.value = null;
  try {
    const result = await request<{ model: string; elapsedMs: number; warning?: string | null }>("ai/test", {
      method: "POST",
      body: JSON.stringify(body())
    });
    message.value = {
      tone: "success",
      text: result.warning
        ? `${result.model} 连接可达，耗时 ${result.elapsedMs}ms。${result.warning}`
        : `${result.model} 连接正常，耗时 ${result.elapsedMs}ms`
    };
    await load();
  } catch (error) {
    message.value = { tone: "danger", text: error instanceof Error ? error.message : "AI 连接失败" };
  } finally {
    testing.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="data-section ai-settings-panel">
    <header class="ai-heading">
      <div class="ai-title-icon"><Bot :size="20" /></div>
      <div>
        <h2>AI 结构化识别</h2>
        <p>{{ currentProvider?.label || "AI" }} · 仅发送 OCR 文字</p>
      </div>
      <label class="switch-control">
        <input v-model="settings.enabled" type="checkbox" :disabled="loading" />
        <span></span>
        {{ settings.enabled ? "已启用" : "未启用" }}
      </label>
    </header>

    <div v-if="loading" class="ai-loading"><LoaderCircle class="spin" :size="22" />正在加载 AI 配置</div>
    <template v-else>
      <div class="ai-stats" aria-label="本月 AI 调用统计">
        <div><span>本月调用</span><strong>{{ settings.statistics.totalCalls }}</strong></div>
        <div><span>成功</span><strong>{{ settings.statistics.successfulCalls }}</strong></div>
        <div><span>失败</span><strong>{{ settings.statistics.failedCalls }}</strong></div>
        <div><span>Token</span><strong>{{ settings.statistics.totalTokens.toLocaleString('zh-CN') }}</strong></div>
      </div>

      <div class="ai-form-grid">
        <label class="field">
          <span>服务商</span>
          <FormSelect
            :model-value="settings.provider"
            :options="settings.providers.map((provider) => ({ value: provider.key, label: provider.label }))"
            aria-label="服务商"
            @update:model-value="settings.provider = $event as AiProviderKey; changeProvider()"
          />
        </label>
        <label class="field">
          <span>模型</span>
          <input v-model.trim="settings.model" maxlength="100" :placeholder="currentProvider?.defaultModel || '模型名称'" />
        </label>
        <label class="field span-2">
          <span>API 地址</span>
          <input v-model.trim="settings.baseUrl" maxlength="300" :placeholder="currentProvider?.defaultBaseUrl || 'https://...'" />
        </label>
        <label class="field span-2">
          <span>API Key</span>
          <div class="key-input"><KeyRound :size="16" /><input v-model="apiKey" type="password" autocomplete="new-password" :placeholder="currentProviderSettings?.apiKeyConfigured ? `已配置 ${currentProviderSettings.apiKeyMasked}` : 'sk-...'" /></div>
        </label>
        <label class="field">
          <span>超时时间</span>
          <div class="input-suffix"><input v-model.number="settings.timeoutSeconds" type="number" min="5" max="120" /><span>秒</span></div>
        </label>
        <label class="field">
          <span>失败重试</span>
          <FormSelect
            :model-value="String(settings.maxRetries)"
            :options="[{ value: '0', label: '不重试' }, { value: '1', label: '1 次' }, { value: '2', label: '2 次' }, { value: '3', label: '3 次' }]"
            aria-label="失败重试"
            @update:model-value="settings.maxRetries = Number($event)"
          />
        </label>
      </div>

      <p v-if="message" :class="['ai-message', message.tone]">
        <CheckCircle2 v-if="message.tone === 'success'" :size="16" />
        <TriangleAlert v-else :size="16" />
        {{ message.text }}
      </p>

      <footer>
        <button class="test-button" type="button" :disabled="saving || testing" @click="testConnection">
          <LoaderCircle v-if="testing" class="spin" :size="16" /><PlugZap v-else :size="16" />
          {{ testing ? "正在测试" : "测试连接" }}
        </button>
        <button class="primary-button" type="button" :disabled="saving || testing" @click="save">
          <LoaderCircle v-if="saving" class="spin" :size="16" /><Save v-else :size="16" />
          {{ saving ? "正在保存" : "保存配置" }}
        </button>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.ai-settings-panel { grid-column: 1 / -1; }
.ai-heading { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; gap: 11px; }
.ai-heading h2, .ai-heading p { margin: 0; }
.ai-heading h2 { font-size: 15px; }
.ai-heading p { margin-top: 3px; color: var(--muted); font-size: 10px; }
.ai-title-icon { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 7px; background: var(--green-soft); color: var(--green); }
.switch-control { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 11px; font-weight: 700; cursor: pointer; }
.switch-control input { position: absolute; opacity: 0; }
.switch-control span { position: relative; width: 36px; height: 20px; border-radius: 10px; background: var(--line-strong); }
.switch-control span::after { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: white; content: ""; transition: transform .16s ease; }
.switch-control input:checked + span { background: var(--green); }
.switch-control input:checked + span::after { transform: translateX(16px); }
.ai-loading { display: flex; min-height: 150px; align-items: center; justify-content: center; gap: 8px; color: var(--muted); font-size: 12px; }
.ai-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 17px; border: 1px solid var(--line); border-radius: 7px; }
.ai-stats div { padding: 11px 13px; border-right: 1px solid var(--line); }
.ai-stats div:last-child { border-right: 0; }
.ai-stats span, .ai-stats strong { display: block; }
.ai-stats span { color: var(--muted); font-size: 10px; }
.ai-stats strong { margin-top: 4px; font-size: 16px; }
.ai-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px; margin-top: 17px; }
.field.span-2 { grid-column: span 2; }
.key-input, .input-suffix { display: flex; height: 39px; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); }
.key-input { gap: 7px; padding-left: 10px; color: var(--muted); }
.key-input input, .input-suffix input { height: 37px; border: 0; }
.input-suffix span { padding-right: 10px; color: var(--muted); font-size: 11px; }
.ai-message { display: flex; align-items: center; gap: 6px; margin: 13px 0 0; font-size: 11px; }
.ai-message.success { color: var(--green); }
.ai-message.notice { color: var(--muted); }
.ai-message.danger { color: var(--red); }
footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 17px; border-top: 1px solid var(--line); padding-top: 14px; }
.test-button { display: inline-flex; min-height: 38px; align-items: center; gap: 6px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--text); padding: 0 13px; font-weight: 700; }
@media (max-width: 600px) {
  .ai-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-stats div:nth-child(2) { border-right: 0; }.ai-stats div:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .ai-form-grid { grid-template-columns: 1fr; }.field.span-2 { grid-column: span 1; }
  footer { display: grid; grid-template-columns: 1fr 1fr; } footer button { justify-content: center; }
}
</style>
