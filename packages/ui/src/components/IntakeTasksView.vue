<script setup lang="ts">
import { computed } from "vue";
import { Camera, CheckCircle2, ChevronDown, Download, LoaderCircle, RefreshCw, TriangleAlert } from "@lucide/vue";
import { formatDateTime } from "../utils/format";
import type { IntakeDraft, OcrStatus, SessionUser } from "../types/api";

const props = defineProps<{
  intakeDrafts: IntakeDraft[];
  ocrStatus: OcrStatus | null;
  session: SessionUser | null;
  refreshing: boolean;
  installingOcr: boolean;
}>();

const emit = defineEmits<{
  (event: "install-ocr"): void;
  (event: "refresh-ocr"): void;
  (event: "open-photo-intake", intakeId?: string): void;
}>();

const ocrQueueSummary = computed(() => {
  const queue = props.ocrStatus?.queue;
  if (!queue) return "进度：暂无任务";
  return `进度：${queue.processing} 处理中 / ${queue.queued} 排队 / ${queue.failed} 失败`;
});

const ocrReadySummary = computed(() => {
  const worker = props.ocrStatus?.worker;
  if (!worker) return "等待 OCR 状态";
  return `${worker.modelVersion || "PP-OCRv4 mobile"} · ${ocrQueueSummary.value}`;
});

const ocrInstalling = computed(() => {
  return props.ocrStatus?.installer?.running || props.ocrStatus?.installer?.state === "installing";
});

function intakeStatus(item: IntakeDraft) {
  const stage = item.processingStage || item.status;
  const states: Record<string, { label: string; tone: string }> = {
    draft: { label: "草稿", tone: "neutral" },
    queued: { label: "排队中", tone: "notice" },
    waiting_runtime: { label: "等待 OCR 环境", tone: "warning" },
    ocr_processing: { label: "OCR 识别中", tone: "notice" },
    rule_parsing: { label: "规则解析中", tone: "notice" },
    ai_queued: { label: "等待 AI 整理", tone: "notice" },
    ai_processing: { label: "AI 整理中", tone: "notice" },
    retry_wait: { label: "等待重试", tone: "warning" },
    needs_review: { label: "待确认", tone: "success" },
    failed: { label: "识别失败", tone: "danger" },
    completed: { label: "已入库", tone: "success" }
  };
  return states[stage] || { label: stage, tone: "neutral" };
}

function intakeName(item: IntakeDraft) {
  return typeof item.userValues.name === "string" && item.userValues.name
    ? item.userValues.name
    : `${item.categoryName || "商品"}拍照草稿`;
}
</script>

<template>
  <section class="intake-task-view">
    <div
      v-if="ocrStatus && !ocrStatus.worker.ready"
      class="ocr-runtime-banner"
      :class="{ installing: ocrInstalling }"
    >
      <LoaderCircle v-if="ocrInstalling" class="spin" :size="20" />
      <TriangleAlert v-else :size="20" />
      <div>
        <strong>{{ ocrInstalling ? "OCR 运行环境安装中" : "OCR 运行环境尚未就绪" }}</strong>
        <span v-if="ocrInstalling">
          正在安装 RapidOCR/OpenVINO，图片仍会安全保存，完成后会自动继续处理
        </span>
        <span v-else>图片仍会安全保存，管理员可一键安装 RapidOCR/OpenVINO 环境</span>
      </div>
      <div class="ocr-runtime-actions">
        <button
          v-if="session?.isAdmin && !ocrInstalling"
          type="button"
          :disabled="installingOcr"
          @click="emit('install-ocr')"
        >
          <LoaderCircle v-if="installingOcr" class="spin" :size="14" />
          <Download v-else :size="14" />
          {{ ocrStatus.installer?.state === 'failed' ? "重新安装" : "安装环境" }}
        </button>
        <button type="button" :disabled="refreshing" @click="emit('refresh-ocr')">
          <RefreshCw :size="14" />
          刷新状态
        </button>
      </div>
      <code v-if="!ocrStatus.worker.errorMessage && !ocrStatus.installer?.logTail.length">等待运行环境检查</code>
      <details v-else class="ocr-error-detail">
        <summary>技术详情</summary>
        <code>{{ ocrStatus.installer?.errorMessage || ocrStatus.worker.errorMessage }}</code>
        <code v-if="ocrStatus.installer?.logTail.length">
          {{ ocrStatus.installer.logTail.slice(-8).join("\n") }}
        </code>
      </details>
    </div>

    <div v-else-if="ocrStatus" class="ocr-runtime-banner ready">
      <CheckCircle2 :size="20" />
      <div>
        <strong>{{ ocrStatus.worker.engine || "RapidOCR" }} 已就绪</strong>
        <span>{{ ocrReadySummary }}</span>
      </div>
    </div>

    <section class="data-section intake-task-section">
      <header class="section-heading">
        <div>
          <h2>录入草稿</h2>
          <p>上传成功后可以关闭页面，后台任务不会丢失</p>
        </div>
        <button class="secondary-action" type="button" @click="emit('open-photo-intake')">
          <Camera :size="16" />新建拍照录入
        </button>
      </header>

      <div v-if="intakeDrafts.length" class="intake-task-list">
        <button
          v-for="item in intakeDrafts"
          :key="item.id"
          type="button"
          @click="emit('open-photo-intake', item.id)"
        >
          <div class="task-image-count"><Camera :size="19" /><span>{{ item.imageCount }}</span></div>
          <div class="task-main">
            <strong>{{ intakeName(item) }}</strong>
            <span>
              {{ item.categoryName || "未分类" }} ·
              {{ item.completedJobCount }}/{{ item.imageCount }} 张已处理 ·
              {{ formatDateTime(item.updatedAt) }}
            </span>
          </div>
          <span :class="['status-chip', intakeStatus(item).tone]">{{ intakeStatus(item).label }}</span>
          <ChevronDown class="task-arrow" :size="17" />
        </button>
      </div>
      <div v-else class="empty-state">
        <Camera :size="30" />
        <strong>还没有拍照录入任务</strong>
        <span>拍摄包装、标签和日期后，识别会在后台运行</span>
      </div>
    </section>
  </section>
</template>
