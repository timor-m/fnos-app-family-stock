<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img :src="appIcon" alt="家藏 Logo" /></div>
        <div>
          <strong>家藏</strong>
          <span>重要物品与囤货雷达</span>
        </div>
      </div>

      <label class="family-field">
        <span>当前家庭</span>
        <FormSelect
          v-model="familyModel"
          :options="families.map((family) => ({ value: family.id, label: family.name }))"
          aria-label="选择家庭"
        />
      </label>

      <nav class="main-nav" aria-label="主要导航">
        <button :class="{ active: activeView === 'overview' }" type="button" @click="emit('navigate', 'overview')">
          <LayoutDashboard :size="19" />
          <span>概览</span>
        </button>
        <button :class="{ active: activeView === 'inventory' || activeView === 'history' }" type="button" @click="emit('navigate', 'inventory')">
          <Boxes :size="19" />
          <span>库存</span>
          <small>{{ dashboard?.summary.activeBatchCount ?? dashboard?.inventoryCount ?? 0 }}</small>
        </button>
        <button :class="{ active: activeView === 'expiry' }" type="button" @click="emit('navigate', 'expiry')">
          <Clock3 :size="19" />
          <span>临期</span>
          <small v-if="dashboard?.summary.expiringCount">{{ dashboard.summary.expiringCount }}</small>
        </button>
        <button :class="{ active: activeView === 'locations' }" type="button" @click="emit('navigate', 'locations')">
          <UserRound :size="19" />
          <span>我的</span>
        </button>
      </nav>

      <div class="sidebar-status">
        <Database :size="17" />
        <div>
          <strong>本地数据</strong>
          <span>{{ serverOnline ? "SQLite 正常" : "连接异常" }}</span>
        </div>
        <span class="status-dot" :class="{ offline: !serverOnline }" :aria-label="serverOnline ? '正常' : '异常'"></span>
      </div>
    </aside>

    <main class="workspace">
      <header class="mobile-masthead">
        <img :src="appIcon" alt="" /><strong>家藏</strong>
        <FormSelect v-model="familyModel" :options="families.map(family => ({ value: family.id, label: family.name }))" aria-label="选择当前家庭" placeholder="选择家庭" />
        <button class="icon-button" type="button" aria-label="待处理录入" @click="emit('navigate', 'intakes')"><Bell :size="19" /><span v-if="dashboard?.summary.pendingCount" class="notification-dot" /></button>
      </header>
      <header class="topbar" :class="{ 'search-disabled': !searchEnabled }">
        <div v-if="searchEnabled" class="search-box">
          <Search :size="18" />
          <input v-model="searchModel" aria-label="搜索库存物品" type="search" :placeholder="searchPlaceholder" />
          <button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchModel = ''">
            <X :size="16" />
          </button>
        </div>

        <div class="topbar-actions">
          <label class="location-select">
            <MapPin :size="17" />
            <FormSelect
              v-model="locationModel"
              :disabled="!currentFamily"
              :options="[{ value: '', label: '全部地点' }, ...(currentFamily?.locations || []).map((location) => ({ value: location.id, label: location.name }))]"
              aria-label="筛选地点"
            />
          </label>
          <button class="icon-button" type="button" aria-label="查看待处理录入" title="查看待处理录入" @click="emit('navigate', 'intakes')">
            <Bell :size="19" />
            <span v-if="dashboard?.summary.pendingCount" class="notification-dot"></span>
          </button>
          <button class="secondary-photo-button" type="button" :disabled="!currentFamily" @click="emit('open-intake')">
            <PackagePlus :size="18" />
            <span>文字录入</span>
          </button>
          <button class="primary-button" type="button" :disabled="!currentFamily" @click="emit('open-photo-intake')">
            <Camera :size="18" />
            <span>拍照录入</span>
          </button>
        </div>
      </header>

      <slot />
    </main>

    <nav class="mobile-nav" aria-label="移动端导航">
      <span class="mobile-nav-rules" aria-hidden="true"></span>
      <div class="mobile-nav-shoulder" aria-hidden="true"></div>
      <svg class="mobile-nav-edge" viewBox="-42 -18 84 22" aria-hidden="true">
        <path d="M-35.1 0 A16 16 0 0 0 -24.088 -4.392 A35 35 0 0 1 24.088 -4.392 A16 16 0 0 0 35.1 0" />
      </svg>
      <button :class="{ active: activeView === 'overview' }" type="button" @click="emit('navigate', 'overview')">
        <span class="mobile-nav-icon"><LayoutDashboard :size="20" /></span>
        <span>概览</span>
      </button>
      <button :class="{ active: activeView === 'inventory' || activeView === 'history' }" type="button" @click="emit('navigate', 'inventory')">
        <span class="mobile-nav-icon"><Boxes :size="20" /></span>
        <span>库存</span>
      </button>
      <div class="mobile-add-slot"><button class="mobile-add" type="button" :disabled="!currentFamily" aria-label="拍照录入" @click="emit('open-photo-intake')">
        <Camera :size="28" />
      </button></div>
      <button :class="{ active: activeView === 'expiry' }" type="button" @click="emit('navigate', 'expiry')">
        <span class="mobile-nav-icon"><Clock3 :size="20" /></span>
        <span>临期</span>
      </button>
      <button :class="{ active: activeView === 'locations' }" type="button" @click="emit('navigate', 'locations')">
        <span class="mobile-nav-icon"><UserRound :size="20" /></span>
        <span>我的</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Bell,
  Boxes,
  Camera,
  Clock3,
  Database,
  LayoutDashboard,
  MapPin,
  PackagePlus,
  Search,
  UserRound,
  X
} from "@lucide/vue";
import FormSelect from "../components/form/FormSelect.vue";
import appIcon from "../assets/app-icon.png";
import type { Dashboard, Family } from "../types/api";

type ViewKey = "overview" | "inventory" | "history" | "expiry" | "intakes" | "locations";

const props = defineProps<{
  activeView: ViewKey;
  families: Family[];
  selectedFamilyId: string;
  currentFamily: Family | null;
  selectedLocationId: string;
  dashboard: Dashboard | null;
  serverOnline: boolean;
  searchEnabled: boolean;
  searchQuery: string;
  searchPlaceholder: string;
}>();

const emit = defineEmits<{
  (event: "navigate", view: ViewKey): void;
  (event: "open-intake"): void;
  (event: "open-photo-intake"): void;
  (event: "update:selectedFamilyId", value: string): void;
  (event: "update:selectedLocationId", value: string): void;
  (event: "update:searchQuery", value: string): void;
}>();

const familyModel = computed({
  get: () => props.selectedFamilyId,
  set: (value: string) => emit("update:selectedFamilyId", value)
});

const locationModel = computed({
  get: () => props.selectedLocationId,
  set: (value: string) => emit("update:selectedLocationId", value)
});

const searchModel = computed({
  get: () => props.searchQuery,
  set: (value: string) => emit("update:searchQuery", value)
});
</script>
