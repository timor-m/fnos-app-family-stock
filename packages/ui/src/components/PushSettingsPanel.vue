<script setup lang="ts">
import { onMounted, ref } from "vue";
import { BellRing, CheckCircle2, LoaderCircle, Save, Send, Shield, TriangleAlert } from "@lucide/vue";
import FormSelect from "./form/FormSelect.vue";
import { request } from "../utils/api";
import type { Family } from "../types/api";

const props = defineProps<{
  families?: Family[];
}>();

type PushChannel = "wecom" | "feishu" | "dingtalk" | "bark" | "webhook";
type PushSchedule = "weekly" | "daily";

type PushSettings = {
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

const channels: Array<{ value: PushChannel; label: string; hint: string }> = [
  { value: "wecom", label: "企业微信机器人", hint: "粘贴企业微信群机器人的 Webhook 地址" },
  { value: "feishu", label: "飞书机器人", hint: "粘贴飞书自定义机器人的 Webhook 地址" },
  { value: "dingtalk", label: "钉钉机器人", hint: "粘贴钉钉群机器人的 Webhook 地址" },
  { value: "bark", label: "Bark（iOS 推送）", hint: "粘贴 Bark 推送地址（含设备路径）" },
  { value: "webhook", label: "通用 JSON Webhook", hint: "粘贴接收 POST JSON 摘要的回调地址" }
];

const weekdays = [
  { value: 1, label: "每周一" },
  { value: 2, label: "每周二" },
  { value: 3, label: "每周三" },
  { value: 4, label: "每周四" },
  { value: 5, label: "每周五" },
  { value: 6, label: "每周六" },
  { value: 0, label: "每周日" }
];

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const sendingNow = ref(false);
const error = ref("");
const notice = ref("");
const webhookInput = ref("");

const settings = ref<PushSettings>({
  enabled: false,
  channel: "wecom",
  webhookConfigured: false,
  webhookUrlMask: "",
  schedule: "weekly",
  weekday: 1,
  sendHour: 9,
  expiringDays: 14,
  familyIds: [],
  includeLowStock: true,
  onlyWhenNonEmpty: true,
  lastSentAt: null,
  lastStatus: "idle",
  lastMessage: null
});

function currentPlaceholder() {
  return channels.find((item) => item.value === settings.value.channel)?.hint || "请输入推送地址";
}

function statusLabel(status: PushSettings["lastStatus"]) {
  if (status === "sent") return "上次发送成功";
  if (status === "skipped") return "上次无待处理项已跳过";
  if (status === "failed") return "上次发送失败";
  return "尚未发送";
}

function formatSentAt(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

async function loadSettings() {
  loading.value = true;
  error.value = "";
  try {
    settings.value = await request<PushSettings>("notifications/push/settings");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "推送配置加载失败";
  } finally {
    loading.value = false;
  }
}

function toggleFamilyScope(familyId: string) {
  if (!familyId) {
    settings.value.familyIds = [];
    return;
  }
  const current = new Set(settings.value.familyIds || []);
  if (current.has(familyId)) {
    current.delete(familyId);
  } else {
    current.add(familyId);
  }
  settings.value.familyIds = [...current];
}

async function saveSettings() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    settings.value = await request<PushSettings>("notifications/push/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled: settings.value.enabled,
        channel: settings.value.channel,
        webhookUrl: webhookInput.value.trim() || undefined,
        schedule: settings.value.schedule,
        weekday: settings.value.weekday,
        sendHour: settings.value.sendHour,
        expiringDays: settings.value.expiringDays,
        familyIds: settings.value.familyIds,
        includeLowStock: settings.value.includeLowStock,
        onlyWhenNonEmpty: settings.value.onlyWhenNonEmpty
      })
    });
    webhookInput.value = "";
    notice.value = "外部推送配置已保存";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

async function testPush() {
  testing.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request<{ title: string }>("notifications/push/test", {
      method: "POST",
      body: JSON.stringify({
        channel: settings.value.channel,
        webhookUrl: webhookInput.value.trim() || undefined,
        expiringDays: settings.value.expiringDays,
        familyIds: settings.value.familyIds,
        includeLowStock: settings.value.includeLowStock
      })
    });
    notice.value = `测试推送已发送：${result.title}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "测试推送失败";
  } finally {
    testing.value = false;
  }
}

async function sendNow() {
  sendingNow.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request<{ digest: { title: string } }>("notifications/push/send-now", {
      method: "POST",
      body: "{}"
    });
    notice.value = `摘要已推送：${result.digest.title}`;
    await loadSettings();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "立即推送失败";
    await loadSettings();
  } finally {
    sendingNow.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <section class="push-settings">
    <header class="push-header">
      <div>
        <h2>外部推送提醒</h2>
        <p>定时将已过期、临期与低库存摘要发送到群机器人或手机，避免 NAS 里的数据长期忘记查看</p>
      </div>
      <label class="push-switch">
        <input v-model="settings.enabled" type="checkbox" />
        <span>{{ settings.enabled ? "已开启" : "未开启" }}</span>
      </label>
    </header>

    <div v-if="loading" class="push-loading">
      <LoaderCircle class="spin" :size="20" />
      <span>正在加载推送配置</span>
    </div>

    <form v-else class="push-form" @submit.prevent="saveSettings">
      <div class="form-grid">
        <label class="field">
          <span>推送渠道</span>
          <FormSelect
            :model-value="settings.channel"
            :options="channels"
            aria-label="推送渠道"
            @update:model-value="settings.channel = $event as PushChannel"
          />
        </label>

        <label class="field">
          <span>提前提醒天数</span>
          <input v-model.number="settings.expiringDays" type="number" min="1" max="90" step="1" />
        </label>

        <label class="field span-2">
          <span>Webhook / 推送地址</span>
          <input
            v-model.trim="webhookInput"
            type="url"
            autocomplete="off"
            :placeholder="settings.webhookConfigured ? `已加密保存（${settings.webhookUrlMask}），留空则保持不变` : currentPlaceholder()"
          />
        </label>

        <label class="field">
          <span>推送频率</span>
          <FormSelect
            :model-value="settings.schedule"
            :options="[{ value: 'weekly', label: '每周摘要' }, { value: 'daily', label: '每日摘要' }]"
            aria-label="推送频率"
            @update:model-value="settings.schedule = $event as PushSchedule"
          />
        </label>

        <label v-if="settings.schedule === 'weekly'" class="field">
          <span>推送星期</span>
          <FormSelect
            :model-value="String(settings.weekday)"
            :options="weekdays.map((day) => ({ value: String(day.value), label: day.label }))"
            aria-label="推送星期"
            @update:model-value="settings.weekday = Number($event)"
          />
        </label>

        <label class="field">
          <span>推送时间（小时）</span>
          <FormSelect
            :model-value="String(settings.sendHour)"
            :options="Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}:00 后` }))"
            aria-label="推送时间"
            @update:model-value="settings.sendHour = Number($event)"
          />
        </label>
      </div>

      <div v-if="props.families && props.families.length > 1" class="push-family-scope">
        <span>推送家庭范围（留空则汇总全部家庭）</span>
        <div class="push-family-chips">
          <button
            type="button"
            :class="{ active: !settings.familyIds.length }"
            @click="toggleFamilyScope('')"
          >
            全部家庭
          </button>
          <button
            v-for="family in props.families"
            :key="family.id"
            type="button"
            :class="{ active: settings.familyIds.includes(family.id) }"
            @click="toggleFamilyScope(family.id)"
          >
            {{ family.name }}
          </button>
        </div>
      </div>

      <div class="push-toggles">
        <label class="push-checkbox">
          <input v-model="settings.includeLowStock" type="checkbox" />
          <span>摘要包含低库存待补货商品</span>
        </label>
        <label class="push-checkbox">
          <input v-model="settings.onlyWhenNonEmpty" type="checkbox" />
          <span>无过期、临期和低库存商品时自动静默不打扰</span>
        </label>
      </div>

      <div class="push-meta">
        <span><Shield :size="14" />推送地址使用本机密钥加密保存，不回传明文</span>
        <span>
          <BellRing :size="14" />
          {{ statusLabel(settings.lastStatus) }} · {{ formatSentAt(settings.lastSentAt) }}
          <template v-if="settings.lastMessage"> · {{ settings.lastMessage }}</template>
        </span>
      </div>

      <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>
      <p v-if="notice" class="push-notice"><CheckCircle2 :size="16" />{{ notice }}</p>

      <footer class="push-actions">
        <button class="secondary-action" type="button" :disabled="testing || saving || sendingNow" @click="testPush">
          <LoaderCircle v-if="testing" class="spin" :size="15" />
          <Send v-else :size="15" />
          {{ testing ? "测试中" : "发送测试" }}
        </button>
        <button
          class="secondary-action"
          type="button"
          :disabled="!settings.webhookConfigured || sendingNow || saving || testing"
          @click="sendNow"
        >
          <LoaderCircle v-if="sendingNow" class="spin" :size="15" />
          <BellRing v-else :size="15" />
          {{ sendingNow ? "推送中" : "立即推送摘要" }}
        </button>
        <button class="primary-button" type="submit" :disabled="saving">
          <LoaderCircle v-if="saving" class="spin" :size="16" />
          <Save v-else :size="16" />
          {{ saving ? "正在保存" : "保存推送配置" }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.push-settings {
  padding: 16px 20px 20px;
}
.push-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.push-header h2,
.push-header p {
  margin: 0;
}
.push-header h2 {
  font-size: 15px;
}
.push-header p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 12px;
}
.push-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.push-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
  padding: 16px 0;
}
.push-family-scope {
  margin-top: 14px;
}
.push-family-scope > span {
  display: block;
  margin-bottom: 7px;
  color: #555b54;
  font-size: 12px;
  font-weight: 700;
}
.push-family-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.push-family-chips button {
  min-height: 28px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  padding: 0 11px;
  font-size: 12px;
  font-weight: 600;
}
.push-family-chips button.active {
  border-color: var(--green);
  background: var(--green-soft);
  color: var(--green);
  font-weight: 700;
}
.push-toggles {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.push-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.push-meta {
  display: grid;
  gap: 6px;
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-soft);
  color: var(--muted);
  font-size: 11px;
}
.push-meta span {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-wrap: anywhere;
}
.push-notice {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 12px 0 0;
  border-radius: 6px;
  background: var(--green-soft);
  color: var(--green);
  padding: 9px 11px;
  font-size: 12px;
  font-weight: 600;
}
.push-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
