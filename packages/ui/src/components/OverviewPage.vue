<script setup lang="ts">
import { AlertTriangle, Boxes, CheckCircle2, Clock3, PackageOpen, PackagePlus } from "@lucide/vue";
import InventoryTable from "./InventoryTable.vue";
import {
  expiryClass,
  expiryLabel,
  formatDate,
  formatQuantity
} from "../utils/format";
import type { Dashboard, InventoryItem, LowStockItem } from "../types/api";

defineProps<{
  dashboard: Dashboard;
  recentItems: InventoryItem[];
  filtered: boolean;
  quickActionBusyId?: string;
}>();

const emit = defineEmits<{
  (event: "navigate", view: "inventory" | "expiry" | "intakes"): void;
  (event: "show-low-stock"): void;
  (event: "operate", item: InventoryItem): void;
  (event: "quick-consume", item: InventoryItem, mode: "one" | "all"): void;
  (event: "restock-low-stock", item: LowStockItem): void;
}>();

function placeText(item: InventoryItem) {
  return item.storagePlaceName ? `${item.locationName}·${item.storagePlaceName}` : item.locationName;
}
</script>

<template>
  <section class="radar-banner" aria-label="记录范围">
    <span>记药品、囤货、耗材和工具。生鲜不用记。</span>
  </section>

  <section class="metrics" aria-label="库存统计">
    <article
      class="metric-card"
      role="button"
      tabindex="0"
      aria-label="查看全部库存"
      @click="emit('navigate', 'inventory')"
      @keydown.enter.prevent="emit('navigate', 'inventory')"
      @keydown.space.prevent="emit('navigate', 'inventory')"
    >
      <div class="metric-icon green"><Boxes :size="20" /></div>
      <span>在库商品</span>
      <strong>{{ dashboard.summary.productCount }}</strong>
      <small>共 {{ formatQuantity(dashboard.summary.totalQuantity) }} 件库存</small>
    </article>

    <article
      class="metric-card"
      role="button"
      tabindex="0"
      aria-label="查看临期管理"
      @click="emit('navigate', 'expiry')"
      @keydown.enter.prevent="emit('navigate', 'expiry')"
      @keydown.space.prevent="emit('navigate', 'expiry')"
    >
      <div class="metric-icon amber"><Clock3 :size="20" /></div>
      <span>30 天内临期</span>
      <strong>{{ dashboard.summary.expiringCount }}</strong>
      <small>{{ dashboard.summary.expiredCount }} 个批次已过期</small>
    </article>

    <article
      class="metric-card"
      role="button"
      tabindex="0"
      aria-label="查看低库存"
      @click="emit('show-low-stock')"
      @keydown.enter.prevent="emit('show-low-stock')"
      @keydown.space.prevent="emit('show-low-stock')"
    >
      <div class="metric-icon red"><AlertTriangle :size="20" /></div>
      <span>低库存</span>
      <strong>{{ dashboard.summary.lowStockCount }}</strong>
      <small>达到补货阈值的商品</small>
    </article>

    <article
      class="metric-card"
      role="button"
      tabindex="0"
      aria-label="查看待处理录入"
      @click="emit('navigate', 'intakes')"
      @keydown.enter.prevent="emit('navigate', 'intakes')"
      @keydown.space.prevent="emit('navigate', 'intakes')"
    >
      <div class="metric-icon blue"><PackageOpen :size="20" /></div>
      <span>待处理录入</span>
      <strong>{{ dashboard.summary.pendingCount }}</strong>
      <small>识别中或等待确认</small>
    </article>
  </section>

  <div class="overview-grid">
    <section class="data-section expiry-section">
      <header class="section-heading">
        <div>
          <h2>临期关注</h2>
          <p>优先处理日期最近的库存</p>
        </div>
        <button type="button" @click="emit('navigate', 'expiry')">查看全部</button>
      </header>

      <div v-if="dashboard.expiring.length" class="expiry-list">
        <article v-for="item in dashboard.expiring.slice(0, 5)" :key="item.batchId">
          <div class="item-symbol">{{ item.name.slice(0, 1) }}</div>
          <div class="item-main">
            <strong>{{ item.name }}</strong>
            <span>{{ placeText(item) }} · {{ formatQuantity(item.quantity) }}{{ item.unit }}</span>
          </div>
          <div class="expiry-meta">
            <span :class="['status-chip', expiryClass(item.daysRemaining)]">
              {{ expiryLabel(item.daysRemaining) }}
            </span>
            <small>{{ formatDate(item.expirationDate) }}</small>
          </div>
        </article>
      </div>
      <div v-else class="empty-state compact">
        <CheckCircle2 :size="28" />
        <strong>暂无临期库存</strong>
      </div>
    </section>

    <section class="data-section">
      <header class="section-heading">
        <div>
          <h2>低库存</h2>
          <p>
            已达到设置的补货阈值
            <template v-if="dashboard.summary.lowStockCount > dashboard.lowStock.length">
              · 共 {{ dashboard.summary.lowStockCount }} 个，这里显示前 {{ dashboard.lowStock.length }} 个
            </template>
          </p>
        </div>
      </header>

      <div v-if="dashboard.lowStock.length" class="stock-list">
        <article v-for="item in dashboard.lowStock" :key="item.productId" class="low-stock-row">
          <div>
            <strong>{{ item.name }}</strong>
            <span v-if="item.brand">{{ item.brand }}</span>
          </div>
          <div class="stock-progress">
            <div>
              <span :style="{ width: `${Math.min(100, (item.quantity / Math.max(item.threshold, 1)) * 100)}%` }"></span>
            </div>
            <small>{{ formatQuantity(item.quantity) }} / {{ formatQuantity(item.threshold) }} {{ item.unit }}</small>
          </div>
          <button class="quick-action-btn finish" type="button" @click="emit('restock-low-stock', item)">
            <PackagePlus :size="13" />补货
          </button>
        </article>
      </div>
      <div v-else class="empty-state compact">
        <CheckCircle2 :size="28" />
        <strong>库存状态正常</strong>
      </div>
    </section>
  </div>

  <section class="data-section table-section">
    <header class="section-heading">
      <div>
        <h2>最近入库</h2>
        <p>当前家庭最近新增的库存批次</p>
      </div>
      <button type="button" @click="emit('navigate', 'inventory')">全部库存</button>
    </header>
    <InventoryTable
      :items="recentItems"
      :filtered="filtered"
      :quick-action-busy-id="quickActionBusyId"
      show-actions
      @operate="emit('operate', $event)"
      @quick-consume="(item, mode) => emit('quick-consume', item, mode)"
    />
  </section>
</template>
