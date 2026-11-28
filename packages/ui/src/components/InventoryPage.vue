<script setup lang="ts">
import { ChevronDown, LoaderCircle, MapPin, PackagePlus, X } from "@lucide/vue";
import InventoryTable from "./InventoryTable.vue";
import type { InventoryItem, Location, StoragePlace } from "../types/api";

defineProps<{
  items: InventoryItem[];
  filtered: boolean;
  inventoryCount: number;
  visibleCount: number;
  hasMore: boolean;
  loadingMore: boolean;
  locations?: Location[];
  selectedLocationId?: string;
  storagePlaces?: StoragePlace[];
  selectedStoragePlaceId?: string;
  lowStockOnly?: boolean;
  quickActionBusyId?: string;
}>();

const emit = defineEmits<{
  (event: "open-intake"): void;
  (event: "load-more"): void;
  (event: "operate", item: InventoryItem): void;
  (event: "quick-consume", item: InventoryItem, mode: "one" | "all"): void;
  (event: "select-location", locationId: string): void;
  (event: "select-storage-place", storagePlaceId: string): void;
  (event: "clear-stock-filter"): void;
}>();
</script>

<template>
  <section class="data-section table-section full-section inventory-section">
    <header class="section-heading">
      <div>
        <h2>库存批次</h2>
        <p>
          共 {{ inventoryCount }} 个有效批次
          <template v-if="inventoryCount > visibleCount">
            · 已显示 {{ visibleCount }} 个
          </template>
        </p>
        <button v-if="lowStockOnly" class="stock-filter" type="button" @click="emit('clear-stock-filter')">
          低库存
          <X :size="13" />
        </button>
      </div>
      <button class="secondary-action" type="button" @click="emit('open-intake')">
        <PackagePlus :size="16" />
        文字录入
      </button>
    </header>

    <div v-if="locations && locations.length > 1" class="mobile-location-chips" role="tablist" aria-label="按房屋地点筛选">
      <MapPin :size="14" class="chip-prefix-icon" />
      <button
        type="button"
        :class="{ active: !selectedLocationId }"
        @click="emit('select-location', '')"
      >
        全部地点
      </button>
      <button
        v-for="loc in locations"
        :key="loc.id"
        type="button"
        :class="{ active: selectedLocationId === loc.id }"
        @click="emit('select-location', loc.id)"
      >
        {{ loc.name }}
      </button>
    </div>

    <div v-if="storagePlaces && storagePlaces.length" class="storage-place-chips" role="tablist" aria-label="按细分存放位置筛选">
      <button
        type="button"
        :class="{ active: !selectedStoragePlaceId }"
        @click="emit('select-storage-place', '')"
      >
        全部位置
      </button>
      <button
        v-for="place in storagePlaces"
        :key="place.id"
        type="button"
        :class="{ active: selectedStoragePlaceId === place.id }"
        @click="emit('select-storage-place', place.id)"
      >
        {{ place.name }}
      </button>
    </div>

    <InventoryTable
      :items="items"
      :filtered="filtered"
      :quick-action-busy-id="quickActionBusyId"
      show-actions
      @operate="emit('operate', $event)"
      @quick-consume="(item, mode) => emit('quick-consume', item, mode)"
    />

    <div v-if="inventoryCount" class="load-more-sentinel">
      <button
        v-if="hasMore"
        type="button"
        :disabled="loadingMore"
        @click="emit('load-more')"
      >
        <LoaderCircle v-if="loadingMore" class="spin" :size="15" />
        <ChevronDown v-else :size="15" />
        {{ loadingMore ? "正在加载更多" : "加载更多" }}
      </button>
      <span v-else>已经到底啦</span>
    </div>
  </section>
</template>
