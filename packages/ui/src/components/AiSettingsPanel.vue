<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Bot, Pencil, Plus, Trash2 } from "@lucide/vue";
import PageSkeleton from "./PageSkeleton.vue";
import ModalFrame from "./form/ModalFrame.vue";
import FormSelect from "./form/FormSelect.vue";
import { useUnsavedChanges } from "../composables/useUnsavedChanges";
import { useConfirm } from "../composables/useConfirm";
import { request } from "../utils/api";

type Header = { name: string; value: string; configured?: boolean };
type Profile = { headers?: Header[]; id: string; name: string; provider: string; baseUrl: string; model: string; timeoutSeconds: number; maxRetries: number; apiKeyConfigured?: boolean; apiKeyMasked?: string; apiKey?: string; clearApiKey?: boolean };
type Settings = { enabled: boolean; defaultProfileId: string; profiles: Profile[]; providers: Array<{ key: string; label: string; defaultBaseUrl: string; defaultModel: string }>; statistics: { totalCalls: number; successfulCalls: number; failedCalls: number; totalTokens: number } };
const settings = ref<Settings>();
const loading = ref(true), saving = ref(false), testing = ref(false), listing = ref(false);
const message = ref(""), editorMessage = ref("");
const editor = ref<Profile | null>(null), models = ref<string[]>([]);
const isNewConnection = computed(() => !!editor.value && !settings.value?.profiles.some(profile => profile.id === editor.value?.id));
const busy = computed(() => saving.value || testing.value || listing.value);
const { askConfirm } = useConfirm();
const { markSaved } = useUnsavedChanges(() => ({ settings: settings.value && { enabled: settings.value.enabled, defaultProfileId: settings.value.defaultProfileId, profiles: settings.value.profiles }, editor: editor.value }), busy);
let editorBaseline = "";
async function load() {
  loading.value = true; message.value = "";
  try { settings.value = await request<Settings>("ai/settings"); markSaved(); }
  catch (err) { message.value = err instanceof Error ? err.message : "配置加载失败"; }
  finally { loading.value = false; }
}
function openEditor(profile?: Profile) {
  editorMessage.value = ""; models.value = [];
  editor.value = profile ? { ...profile, headers: (profile.headers || []).map(header => ({ ...header })), apiKey: "" } : { id: `new-${crypto.randomUUID()}`, headers: [], name: "", provider: "custom", baseUrl: "", model: "", apiKey: "", timeoutSeconds: 30, maxRetries: 1 };
  editorBaseline = JSON.stringify(editor.value);
}
async function closeEditor() {
  if (busy.value) return;
  if (JSON.stringify(editor.value) !== editorBaseline && !await askConfirm({ title: "放弃未保存的连接？", message: "关闭后将丢失本次修改。", confirmText: "放弃修改", danger: true })) return;
  editor.value = null;
}
function changeProvider(value: string) {
  if (!editor.value) return;
  const preset = settings.value?.providers.find(p => p.key === value);
  Object.assign(editor.value, { provider: value, baseUrl: preset?.defaultBaseUrl || "", model: preset?.defaultModel || "", apiKey: "", clearApiKey: false, apiKeyConfigured: false, headers: [] });
  models.value = []; editorMessage.value = "";
}
async function saveSettings(profiles = settings.value?.profiles, defaultId = settings.value?.defaultProfileId, close = false) {
  if (busy.value || !settings.value || !profiles) return;
  saving.value = true; message.value = ""; editorMessage.value = "";
  try {
    const result = await request<Settings>("ai/settings", { method: "PUT", body: JSON.stringify({ enabled: profiles.length ? settings.value.enabled : false, profiles, defaultProfileId: defaultId }) });
    const savedMessage = close ? (isNewConnection.value ? "连接已添加并保存" : "连接修改已保存") : "AI 配置已保存";
    settings.value = result;
    if (close) editor.value = null;
    markSaved(); message.value = savedMessage;
  } catch (err) {
    const text = err instanceof Error ? err.message : "保存失败";
    if (editor.value) editorMessage.value = text; else message.value = text;
  } finally { saving.value = false; }
}
async function saveEditor() {
  if (!editor.value || !settings.value) return;
  const form = editor.value;
  if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) { editorMessage.value = "请填写连接名称、API 基础地址和模型 ID"; return; }
  const profiles = [...settings.value.profiles];
  const index = profiles.findIndex(p => p.id === form.id);
  if (index < 0) profiles.push({ ...form }); else profiles[index] = { ...form };
  await saveSettings(profiles, settings.value.defaultProfileId || form.id, true);
}
async function removeProfile(profile: Profile) {
  if (busy.value || !settings.value) return;
  const isDefault = profile.id === settings.value.defaultProfileId;
  if (!await askConfirm({ title: `删除「${profile.name}」？`, message: isDefault ? "此连接是默认连接。删除后自动选择剩余首个连接；没有连接时停用 AI。" : "保存后将移除该连接的地址、模型和密钥。", confirmText: "删除连接", danger: true })) return;
  const remaining = settings.value.profiles.filter(p => p.id !== profile.id);
  await saveSettings(remaining, isDefault ? remaining[0]?.id || "" : settings.value.defaultProfileId);
}
async function fetchModels() {
  if (!editor.value || busy.value) return;
  listing.value = true; editorMessage.value = ""; models.value = [];
  try {
    const result = await request<{ models: string[] }>("ai/models", { method: "POST", body: JSON.stringify(editor.value) });
    models.value = result.models;
    editorMessage.value = models.value.length ? `已获取 ${models.value.length} 个模型，可选择或手动输入` : "暂无可用模型，请手动填写模型 ID";
  } catch (err) { editorMessage.value = err instanceof Error ? err.message : "获取模型失败"; }
  finally { listing.value = false; }
}
async function testConnection() {
  if (!editor.value || busy.value) return;
  testing.value = true; editorMessage.value = "";
  try {
    const result = await request<{ model: string; elapsedMs: number; warning?: string }>("ai/test", { method: "POST", body: JSON.stringify(editor.value) });
    editorMessage.value = `${result.model} 连接正常，耗时 ${result.elapsedMs}ms${result.warning ? `。${result.warning}` : ""}`;
  } catch (err) { editorMessage.value = err instanceof Error ? err.message : "连接失败"; }
  finally { testing.value = false; }
}
function hostOf(url: string) { try { return new URL(url).host; } catch { return url; } }
onMounted(load);
</script>

<template>
  <section class="ai-settings-panel">
    <PageSkeleton v-if="loading" />
    <p v-else-if="!settings" class="inline-error" role="alert">{{ message }}<button type="button" @click="load">重试</button></p>
    <template v-else>
      <section class="connection-band" :inert="busy">
        <header><Bot :size="21" /><div><h2>连接配置</h2><p>每份连接包含地址、Key、扩展请求头和模型，可添加多份</p></div></header>
        <div class="connection-list">
          <article v-for="profile in settings.profiles" :key="profile.id">
            <div class="connection-summary"><strong>{{ profile.name }}<em v-if="profile.id === settings.defaultProfileId">默认</em></strong><span>{{ settings.providers.find(p => p.key === profile.provider)?.label }} · {{ hostOf(profile.baseUrl) }} · {{ profile.model }}</span></div>
            <div class="connection-actions"><button class="icon-button" type="button" :aria-label="`编辑连接 ${profile.name}`" @click="openEditor(profile)"><Pencil :size="16" /></button><button class="icon-button danger-button" type="button" :aria-label="`删除连接 ${profile.name}`" @click="removeProfile(profile)"><Trash2 :size="16" /></button></div>
          </article>
        </div>
        <div v-if="!settings.profiles.length" class="empty-state compact"><Bot :size="28" /><strong>尚未添加连接</strong><span>添加后即可启用 AI 整理</span><button class="secondary-action" type="button" @click="openEditor()"><Plus :size="16" />添加连接配置</button></div>
        <button v-else class="secondary-action" type="button" @click="openEditor()"><Plus :size="16" />添加连接配置</button>
      </section>
      <section class="connection-band" :inert="busy">
        <header><Bot :size="21" /><div><h2>模型配置</h2><p>后台识别使用默认连接，仅发送 OCR 文字</p></div></header>
        <label class="enable-row"><div><strong>启用 AI 整理</strong><span>将识别文本整理为结构化字段</span></div><input v-model="settings.enabled" type="checkbox" :disabled="!settings.profiles.length" /></label>
        <label class="field"><span>默认连接</span><FormSelect v-model="settings.defaultProfileId" :options="settings.profiles.map(p => ({value:p.id,label:p.name}))" aria-label="默认连接" placeholder="请先添加连接配置" /></label>
        <footer><button class="primary-button" type="button" @click="saveSettings()">{{ saving ? '正在保存' : '保存配置' }}</button></footer>
      </section>
      <p v-if="message" class="inline-error" role="status">{{ message }}</p>
      <div class="ai-stats"><div><span>本月调用</span><strong>{{ settings.statistics.totalCalls }}</strong></div><div><span>成功 / 失败</span><strong>{{ settings.statistics.successfulCalls }} / {{ settings.statistics.failedCalls }}</strong></div><div><span>Token</span><strong>{{ settings.statistics.totalTokens.toLocaleString('zh-CN') }}</strong></div></div>
    </template>
    <ModalFrame :open="!!editor" :title="isNewConnection ? '添加连接配置' : '编辑连接配置'" description="保存后立即生效，无需再点击页面上的保存配置。" :busy="busy" @close="closeEditor">
      <form v-if="editor" class="connection-editor" @submit.prevent="saveEditor">
        <fieldset :disabled="busy">
          <label class="field"><span>连接名称</span><input v-model="editor.name" required maxlength="80" placeholder="例如：本地模型、日常整理" /></label>
          <label class="field"><span>服务商预设</span><FormSelect :model-value="editor.provider" :options="settings?.providers.map(p => ({value:p.key,label:p.label})) || []" aria-label="服务商预设" @update:model-value="changeProvider" /></label>
          <label class="field"><span>API 基础地址</span><input v-model.trim="editor.baseUrl" required maxlength="300" placeholder="https://…/v1" /><small>填写兼容 Chat Completions 的基础地址，不含 /chat/completions</small></label>
          <label class="field"><span>API Key{{ editor.provider === 'ollama' ? '（可选）' : '' }}</span><input v-model="editor.apiKey" type="password" autocomplete="new-password" :placeholder="editor.apiKeyConfigured ? `已配置 ${editor.apiKeyMasked}，留空保留` : '填写 API Key'" /><small>使用扩展请求头鉴权时可留空；更换地址或服务商后，请重新填写密钥</small></label>
          <label class="clear-key"><input v-model="editor.clearApiKey" type="checkbox" />清除已保存的密钥</label>
          <details class="custom-headers" :open="!!editor.headers?.length">
            <summary>进阶配置</summary>
            <div class="custom-headers-content">
              <strong>自定义 Headers</strong>
              <div v-for="(header, index) in editor.headers" :key="index" class="header-row" role="group" :aria-label="`请求头 ${index + 1}`">
                <strong class="header-group-title">Header {{ index + 1 }}</strong>
                <input v-model="header.name" :aria-label="`请求头名称 ${index + 1}`" placeholder="Header 名称" maxlength="128" autocomplete="off" spellcheck="false" />
                <input v-model="header.value" type="text" :aria-label="`请求头值 ${index + 1}`" :placeholder="header.configured ? '已配置，留空保持不变' : 'Header 值'" maxlength="8192" autocomplete="off" spellcheck="false" />
                <button class="header-remove" type="button" :aria-label="`删除请求头 ${index + 1}`" @click="editor.headers?.splice(index, 1)"><Trash2 :size="16" /><span>删除此组</span></button>
              </div>
              <button class="header-add" type="button" :disabled="(editor.headers?.length || 0) >= 32" @click="(editor.headers ||= []).push({ name: '', value: '' })"><Plus :size="14" />添加 Header</button>
              <small>附加到此连接的每次 AI 请求，同名 Header 覆盖默认值。已有值留空保持不变，按组删除名称和值；可配置 Authorization 或 x-api-key 鉴权。更换地址、服务商或名称后需重新填写。</small>
            </div>
          </details>
          <label class="field"><span>模型 ID</span><input v-model.trim="editor.model" required maxlength="100" placeholder="选择或手动填写模型 ID" /></label>
          <div class="model-picker"><button class="secondary-action" type="button" @click="fetchModels">{{ listing ? '正在获取' : '获取模型列表' }}</button><FormSelect v-if="models.length" :model-value="editor.model" :options="models.map(id => ({value:id,label:id}))" aria-label="可用模型" @update:model-value="editor.model = $event" /></div>
          <div class="editor-row"><label class="field"><span>超时（秒）</span><input v-model.number="editor.timeoutSeconds" type="number" min="5" max="3600" /></label><label class="field"><span>失败重试</span><input v-model.number="editor.maxRetries" type="number" min="0" max="3" /></label></div>
        </fieldset>
        <p v-if="editorMessage" class="editor-message" role="status">{{ editorMessage }}</p>
        <footer><button class="secondary-action" type="button" :disabled="busy" @click="testConnection">{{ testing ? '正在测试' : '测试连接' }}</button><button class="primary-button" type="submit" :disabled="busy">{{ saving ? '正在保存' : isNewConnection ? '保存并添加' : '保存修改' }}</button></footer>
      </form>
    </ModalFrame>
  </section>
</template>
<style scoped>
.ai-settings-panel { display:grid; gap:16px; }
.connection-band > header { display:flex; align-items:center; gap:10px; margin-bottom:16px; }
h2,p { margin:0; } h2 { font-size:16px; } header > svg { color:var(--green); flex-shrink:0; } header p, small { color:var(--muted); font-size:12px; line-height:1.5; } header p { margin-top:4px; }
.connection-band + .connection-band { border-top:1px solid var(--line); padding-top:18px; }
.connection-list article { display:flex; gap:10px; align-items:center; padding:12px 0; border-bottom:1px solid var(--line); }
.connection-list { margin-bottom:14px; } .connection-summary { flex:1; min-width:0; display:grid; gap:5px; } .connection-summary strong { font-size:14px; } .connection-summary span { color:var(--muted); font-size:12px; overflow-wrap:anywhere; } em { display:inline-block; margin-left:8px; padding:2px 6px; background:var(--green-soft); color:var(--green); border-radius:5px; font-size:11px; font-style:normal; }
.connection-actions { display:flex; gap:6px; flex-shrink:0; }
.enable-row { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; } .enable-row > div { display:grid; gap:4px; } .enable-row span { font-size:12px; color:var(--muted); } input[type=checkbox] { accent-color:var(--green); width:18px; height:18px; flex-shrink:0; }
footer { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:10px; padding-top:16px; } .ai-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border-top:1px solid var(--line); padding-top:16px; gap:12px; } .ai-stats span,.ai-stats strong { display:block; } .ai-stats span { font-size:12px; color:var(--muted); } .ai-stats strong { margin-top:6px; font-size:16px; }
.connection-editor { padding:18px 22px; } fieldset { border:0; padding:0; margin:0; min-width:0; display:grid; gap:14px; } .editor-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; } .model-picker { display:flex; gap:10px; flex-wrap:wrap; } .model-picker > .form-select { flex:1; min-width:180px; } .clear-key { display:flex; gap:8px; align-items:center; font-size:12px; color:var(--muted); } .editor-message { margin-top:14px; font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
.custom-headers summary { cursor:pointer; font-size:14px; font-weight:600; }
.custom-headers-content { display:grid; gap:10px; padding-top:12px; }
.custom-headers-content > strong { font-size:14px; }
.custom-headers-content > button { justify-self:start; }
.header-row { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.5fr) 30px; gap:8px; align-items:center; }
.connection-editor input:not([type=checkbox]) {
  display:block; width:100%; min-width:0; max-width:100%; box-sizing:border-box;
  height:44px; border:1px solid var(--line-strong); border-radius:10px;
  background:var(--surface); color:var(--text); padding:0 12px; outline:0;
  font:inherit; font-size:14px; transition:border-color .15s, box-shadow .15s;
}
.connection-editor input:not([type=checkbox]):focus { border-color:var(--green); box-shadow:0 0 0 3px var(--green-soft); }
@media(max-width:760px), (pointer:coarse) { .connection-editor input:not([type=checkbox]) { font-size:16px; } }
.header-group-title,.header-remove span { display:none; }
.header-remove { display:flex; align-items:center; justify-content:center; gap:6px; min-height:32px; border:0; background:transparent; color:var(--muted); cursor:pointer; }
.header-remove:hover { color:var(--red); }
.header-add { min-height:34px; padding:0 11px; border:0; border-radius:999px; background:var(--green-soft); color:var(--green); display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; cursor:pointer; }
.header-add:disabled { opacity:.62; cursor:not-allowed; }
@media(max-width:760px), (pointer:coarse) {
  .header-row { grid-template-columns:minmax(0,1fr) auto; }
  .header-group-title { display:block; font-size:14px; }
  .header-row input { grid-column:1 / -1; }
  .header-remove { grid-column:2; grid-row:1; min-height:44px; padding:0 8px; color:var(--red); font:inherit; font-size:14px; }
  .header-remove span { display:inline; }
  .header-row + .header-row { padding-top:12px; border-top:1px solid var(--line); }
}
@media(max-width:760px) { .connection-editor { padding:16px; } .connection-actions { gap:4px; } }
</style>
