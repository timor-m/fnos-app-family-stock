<script setup lang="ts">
import { CheckCheck, Minus, MoreHorizontal, PackageOpen } from "@lucide/vue";
import type { InventoryItem } from "../types/api";

defineProps<{
  items: InventoryItem[];
  filtered?: boolean;
  showExpiryFirst?: boolean;
  showActions?: boolean;
  quickActionBusyId?: string;
}>();

defineEmits<{
  operate: [item: InventoryItem];
  "quick-consume": [item: InventoryItem, mode: "one" | "all"];
}>();

function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "未设置";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(`${value}T00:00:00`));
}

function expiryLabel(days: number | null) {
  if (days === null) {
    return "未设置";
  }
  if (days < 0) {
    return `已过期 ${Math.abs(days)} 天`;
  }
  if (days === 0) {
    return "今天到期";
  }
  return `${days} 天后`;
}

function expiryClass(days: number | null) {
  if (days === null) {
    return "neutral";
  }
  if (days < 0) {
    return "danger";
  }
  if (days <= 7) {
    return "warning";
  }
  return "notice";
}

function productSubtitle(item: InventoryItem) {
  return [item.brand, item.specification].filter(Boolean).join(" · ");
}

function locationLabel(item: InventoryItem) {
  return item.storagePlaceName ? `${item.locationName} · ${item.storagePlaceName}` : item.locationName;
}
</script>

<template>
  <div v-if="!items.length" class="empty-state">
    <PackageOpen :size="32" />
    <strong>{{ filtered ? "没有匹配的库存" : "暂无库存记录" }}</strong>
    <span v-if="filtered">换个词，或清掉搜索</span>
  </div>

  <div v-else class="inventory-table-wrap">
    <table class="inventory-table">
      <thead>
        <tr>
          <th>商品</th>
          <th>{{ showExpiryFirst ? "到期状态" : "品类" }}</th>
          <th>存放位置</th>
          <th>库存</th>
          <th>{{ showExpiryFirst ? "品类" : "到期日期" }}</th>
          <th v-if="showActions" class="action-heading">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.batchId">
          <td class="product-cell" data-label="商品">
            <div class="table-product">
              <span class="table-symbol">
                <img v-if="item.coverImageUrl" :src="item.coverImageUrl" :alt="item.name" loading="lazy" />
                <template v-else>{{ item.name.slice(0, 1) }}</template>
              </span>
              <div>
                <strong>{{ item.name }}</strong>
                <small v-if="productSubtitle(item)">{{ productSubtitle(item) }}</small>
                <small v-if="item.stockedByName || item.stockedByUserId" class="stocked-by">
                  入库：{{ item.stockedByName || item.stockedByUserId }}
                </small>
              </div>
            </div>
          </td>
          <td v-if="showExpiryFirst" data-label="到期状态">
            <span :class="['status-chip', expiryClass(item.daysRemaining)]">
              {{ expiryLabel(item.daysRemaining) }}
            </span>
            <small class="cell-subtitle">{{ formatDate(item.expirationDate) }}</small>
          </td>
          <td v-else data-label="品类">{{ item.categoryName }}</td>
          <td data-label="存放位置">
            <span>{{ locationLabel(item) }}</span>
          </td>
          <td class="quantity-cell" data-label="库存">{{ formatQuantity(item.quantity) }} {{ item.unit }}</td>
          <td v-if="showExpiryFirst" data-label="品类">{{ item.categoryName }}</td>
          <td v-else data-label="到期日期">
            <span :class="item.daysRemaining !== null ? ['date-status', expiryClass(item.daysRemaining)] : ''">
              {{ formatDate(item.expirationDate) }}
            </span>
          </td>
          <td v-if="showActions" class="action-cell" data-label="操作">
            <div class="row-actions">
              <button
                v-if="item.quantity > 1"
                class="quick-action-btn"
                type="button"
                :disabled="quickActionBusyId === item.batchId"
                :title="`快捷消耗 1 ${item.unit}`"
                @click="$emit('quick-consume', item, 'one')"
              >
                <Minus :size="13" />1
              </button>
              <button
                class="quick-action-btn finish"
                type="button"
                :disabled="quickActionBusyId === item.batchId"
                :title="`标记 ${item.name} 已用完`"
                @click="$emit('quick-consume', item, 'all')"
              >
                <CheckCheck :size="13" />用完
              </button>
              <button
                class="row-action"
                type="button"
                :disabled="quickActionBusyId === item.batchId"
                :aria-label="`处理 ${item.name}`"
                :title="`处理 ${item.name}`"
                @click="$emit('operate', item)"
              >
                <MoreHorizontal :size="18" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
