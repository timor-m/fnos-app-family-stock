<script setup lang="ts">
import { ref as overlayRef, toRef } from "vue";
import { useOverlay } from "../composables/useOverlay";
import { computed } from "vue";
import { Camera, CheckCircle2, TriangleAlert, X } from "@lucide/vue";
import { formatDateTime } from "../utils/format";
import type { IntakeDraft } from "../types/api";

const props = defineProps<{
  open: boolean;
  intakeDrafts: IntakeDraft[];
}>();

const pendingDrafts = computed(() =>
  props.intakeDrafts.filter((item) => !["completed", "cancelled"].includes(item.status))
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "open-intake", intakeId: string): void;
}>();

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

const overlayPanel = overlayRef<HTMLElement | null>(null);
useOverlay(toRef(props, "open"), overlayPanel, () => emit("close"));
</script>

<template>
  <Teleport to="body">
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section ref="overlayPanel" tabindex="-1" class="modal compact-modal message-modal" role="dialog" aria-modal="true" aria-labelledby="messages-title">
      <header class="modal-header">
        <div>
          <h2 id="messages-title">消息</h2>
          <p>{{ pendingDrafts.length ? `${pendingDrafts.length} 条拍照录入待处理` : "暂无待处理消息" }}</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="20" />
        </button>
      </header>

      <div v-if="pendingDrafts.length" class="message-list">
        <button
          v-for="item in pendingDrafts"
          :key="item.id"
          type="button"
          @click="emit('open-intake', item.id)"
        >
          <div class="task-image-count"><Camera :size="18" /><span>{{ item.imageCount }}</span></div>
          <div class="task-main">
            <strong>{{ intakeName(item) }}</strong>
            <span>
              {{ item.categoryName || "未分类" }} ·
              {{ item.completedJobCount }}/{{ item.imageCount }} 张已处理 ·
              {{ formatDateTime(item.updatedAt) }}
            </span>
          </div>
          <span :class="['status-chip', intakeStatus(item).tone]">{{ intakeStatus(item).label }}</span>
        </button>
      </div>
      <div v-else class="empty-state compact">
        <CheckCircle2 :size="28" />
        <strong>暂无消息</strong>
        <span>需要确认的拍照录入会显示在这里</span>
      </div>
    </section>
  </div>
  </Teleport>
</template>
