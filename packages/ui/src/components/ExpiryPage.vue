<script setup lang="ts">
import InventoryTable from "./InventoryTable.vue";
import type { InventoryItem } from "../types/api";

defineProps<{
  items: InventoryItem[];
  filtered: boolean;
  quickActionBusyId?: string;
}>();

const emit = defineEmits<{
  (event: "operate", item: InventoryItem): void;
  (event: "quick-consume", item: InventoryItem, mode: "one" | "all"): void;
}>();
</script>

<template>
  <section class="data-section table-section full-section">
    <header class="section-heading">
      <div>
        <h2>临期与过期批次</h2>
        <p>未来 30 天内到期及已经过期的库存{{ items.length ? ` · ${items.length} 个批次` : "" }}</p>
      </div>
    </header>

    <InventoryTable
      :items="items"
      :filtered="filtered"
      :quick-action-busy-id="quickActionBusyId"
      show-actions
      show-expiry-first
      @operate="emit('operate', $event)"
      @quick-consume="(item, mode) => emit('quick-consume', item, mode)"
    />
  </section>
</template>
