<script setup lang="ts">
import { RefreshCw } from "@lucide/vue";
import InventoryHistoryList from "./InventoryHistoryList.vue";
import type { InventoryHistoryItem } from "../types/api";

defineProps<{
  items: InventoryHistoryItem[];
  refreshing: boolean;
  filtered?: boolean;
}>();

const emit = defineEmits<{
  (event: "refresh"): void;
  (event: "restock", item: InventoryHistoryItem): void;
}>();
</script>

<template>
  <section class="data-section history-section full-section">
    <header class="section-heading">
      <div>
        <h2>历史物品</h2>
        <p>{{ filtered ? `匹配 ${items.length} 个历史物品` : `共 ${items.length} 个已离库批次` }}</p>
      </div>
      <button class="secondary-action" type="button" :disabled="refreshing" @click="emit('refresh')">
        <RefreshCw :size="16" />
        刷新
      </button>
    </header>

    <InventoryHistoryList :items="items" :filtered="filtered" @restock="emit('restock', $event)" />
  </section>
</template>
