<script setup lang="ts">
import { History, PackageOpen } from "@lucide/vue";
import { formatDate, formatDateTime, formatQuantity } from "../utils/format";

type InventoryHistoryItem = {
  transactionId: string;
  transactionType: "consume" | "discard" | "transfer_out" | "adjust";
  initialQuantity: number;
  unit: string;
  reason: string | null;
  finalizedAt: string;
  operatorUserId: string;
  operatorName: string | null;
  batchId: string;
  batchStatus: "depleted" | "discarded";
  currentQuantity: number;
  productId: string;
  name: string;
  brand: string | null;
  categoryName: string;
  categoryKey: string;
  fromLocationId: string | null;
  fromLocationName: string | null;
  toLocationId: string | null;
  toLocationName: string | null;
  expirationDate: string | null;
  unitPrice: number | null;
  channel: string | null;
};

defineProps<{
  items: InventoryHistoryItem[];
}>();

const operationMap: Record<InventoryHistoryItem["transactionType"], { label: string; tone: string }> = {
  consume: { label: "已耗尽", tone: "neutral" },
  discard: { label: "已丢弃", tone: "danger" },
  transfer_out: { label: "已转移", tone: "warning" },
  adjust: { label: "盘点清零", tone: "neutral" }
};

const batchStatusMap: Record<InventoryHistoryItem["batchStatus"], { label: string; tone: string }> = {
  depleted: { label: "不在当前库存", tone: "neutral" },
  discarded: { label: "不在当前库存", tone: "danger" }
};

function operationInfo(type: InventoryHistoryItem["transactionType"]) {
  return operationMap[type] || { label: type, tone: "neutral" };
}

function batchStatusInfo(status: InventoryHistoryItem["batchStatus"]) {
  return batchStatusMap[status] || { label: status, tone: "neutral" };
}

function quantityText(item: InventoryHistoryItem) {
  return `${formatQuantity(item.initialQuantity)} ${item.unit}`;
}

function operationLabel(item: InventoryHistoryItem) {
  return operationInfo(item.transactionType).label;
}

function locationText(item: InventoryHistoryItem) {
  if (item.fromLocationName && item.toLocationName) {
    return `${item.fromLocationName} → ${item.toLocationName}`;
  }
  return item.toLocationName || item.fromLocationName || "未记录地点";
}
</script>

<template>
  <div v-if="!items.length" class="empty-state">
    <PackageOpen :size="32" />
    <strong>暂无历史物品</strong>
    <span>已耗尽、已丢弃或已完全转移的物品会显示在这里</span>
  </div>

  <div v-else class="history-list">
    <article v-for="item in items" :key="item.transactionId" class="history-card">
      <div class="history-symbol">
        <History :size="18" />
      </div>
      <div class="history-main">
        <div class="history-title-row">
          <div>
            <strong>{{ item.name }}</strong>
            <span>
              {{ item.categoryName }}
              <template v-if="item.brand"> · {{ item.brand }}</template>
            </span>
          </div>
          <div class="history-quantity">原数量 {{ quantityText(item) }}</div>
        </div>

        <div class="history-meta">
          <span :class="['status-chip', operationInfo(item.transactionType).tone]">
            {{ operationLabel(item) }}
          </span>
          <span :class="['status-chip', batchStatusInfo(item.batchStatus).tone]">
            {{ batchStatusInfo(item.batchStatus).label }}
          </span>
          <span>{{ locationText(item) }}</span>
          <span>操作人：{{ item.operatorName || item.operatorUserId }}</span>
          <span>离库：{{ formatDateTime(item.finalizedAt) }}</span>
        </div>

        <div class="history-detail">
          <span>当前剩余 {{ formatQuantity(item.currentQuantity) }} {{ item.unit }}</span>
          <span>到期：{{ formatDate(item.expirationDate) }}</span>
          <span v-if="item.channel">渠道：{{ item.channel }}</span>
          <span v-if="item.unitPrice !== null">单价：¥{{ formatQuantity(item.unitPrice) }}</span>
        </div>
        <p v-if="item.reason" class="history-reason">原因：{{ item.reason }}</p>
      </div>
    </article>
  </div>
</template>
