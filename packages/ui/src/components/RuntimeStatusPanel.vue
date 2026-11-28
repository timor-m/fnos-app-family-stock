<script setup lang="ts">
import { computed } from "vue";
import { Bot, Camera, Database, RefreshCw, ShieldCheck } from "@lucide/vue";
import type { AiStatus, OcrStatus, SystemStatus } from "../types/api";

const props = defineProps<{
  ocrStatus: OcrStatus | null;
  aiStatus: AiStatus | null;
  systemStatus: SystemStatus | null;
  refreshing?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  (event: "refresh"): void;
}>();

const gatewayModeLabel = computed(() => {
  if (!props.systemStatus) return "等待系统状态";
  return props.systemStatus.accessMode === "gateway"
    ? `统一网关 · ${props.systemStatus.gatewayPrefix}`
    : `端口模式 · ${props.systemStatus.appPort || "未配置端口"}`;
});

const aiProviderStatusLabel = computed(() => {
  const settings = props.aiStatus?.settings || props.systemStatus?.ai;
  if (!settings) return "等待 AI 状态";
  if (!settings.enabled) return `${settings.provider || "AI"} · 未启用`;
  const configured = "apiKeyConfigured" in settings ? settings.apiKeyConfigured : settings.configured;
  return `${settings.provider} · ${settings.model || "未配置模型"} · ${configured ? "Key 已配置" : "Key 未配置"}`;
});

const aiQueueSummary = computed(() => {
  const queue = props.aiStatus?.queue;
  if (!queue) return "进度：暂无任务";
  return `进度：${queue.processing} 处理中 / ${queue.queued} 排队 / ${queue.failed} 失败`;
});

const ocrQueueSummary = computed(() => {
  const queue = props.ocrStatus?.queue;
  if (!queue) return "进度：暂无任务";
  return `进度：${queue.processing} 处理中 / ${queue.queued} 排队 / ${queue.failed} 失败`;
});

const ocrVersionSummary = computed(() => {
  const worker = props.ocrStatus?.worker;
  if (!worker) return "Python/OpenVINO：等待检测";
  const python = worker.pythonVersion || "Python 未检测";
  const openvino = worker.openvinoVersion || "OpenVINO 未检测";
  const rapidocr = worker.rapidocrVersion || "RapidOCR 未检测";
  return `${python} · ${openvino} · ${rapidocr}`;
});

const nodeRuntimeSummary = computed(() => {
  if (!props.systemStatus) return "Node：等待检测";
  return `${props.systemStatus.nodeVersion} · ${props.systemStatus.nodePlatform}/${props.systemStatus.nodeArch}`;
});
</script>

<template>
  <section class="profile-panel runtime-panel">
    <header class="section-heading">
      <div>
        <h2>服务与环境</h2>
        <p>查看连接状态、识别队列与运行版本</p>
      </div>
      <button class="secondary-action" type="button" :disabled="refreshing" @click="emit('refresh')">
        <RefreshCw :size="16" />
        刷新
      </button>
    </header>

    <p v-if="error" class="inline-error" role="alert">{{ error }}<button type="button" @click="emit('refresh')">重试</button></p>
    <div class="runtime-status-grid">
      <article>
        <div class="runtime-status-icon green"><ShieldCheck :size="18" /></div>
        <div>
          <strong>fnOS 网关</strong>
          <span>{{ gatewayModeLabel }}</span>
          <code v-if="systemStatus">{{ systemStatus.accessMode === "gateway" ? systemStatus.gatewayPrefix : `:${systemStatus.appPort || "-"}` }}</code>
        </div>
      </article>

      <article>
        <div class="runtime-status-icon blue"><Bot :size="18" /></div>
        <div>
          <strong>AI Provider</strong>
          <span>{{ aiProviderStatusLabel }}</span>
          <code>{{ aiQueueSummary }}</code>
        </div>
      </article>

      <article>
        <div class="runtime-status-icon amber"><Camera :size="18" /></div>
        <div>
          <strong>OCR 状态</strong>
          <span>{{ ocrStatus?.worker.ready ? "RapidOCR/OpenVINO 已就绪" : (ocrStatus?.worker.errorMessage || "等待 OCR 状态") }}</span>
          <code>{{ ocrQueueSummary }}</code>
        </div>
      </article>

      <article>
        <div class="runtime-status-icon neutral"><Database :size="18" /></div>
        <div>
          <strong>运行版本</strong>
          <span>{{ nodeRuntimeSummary }}</span>
          <code>{{ ocrVersionSummary }}</code>
        </div>
      </article>
    </div>
  </section>
</template>
