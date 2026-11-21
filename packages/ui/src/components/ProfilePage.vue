<script setup lang="ts">
import { computed } from "vue";
import { BellRing, Bot, ChevronDown, Database, Home, MapPin, MapPinned, Pencil, Plus, ShieldCheck, Trash2, UserRound } from "@lucide/vue";
import AiSettingsPanel from "./AiSettingsPanel.vue";
import PushSettingsPanel from "./PushSettingsPanel.vue";
import RuntimeStatusPanel from "./RuntimeStatusPanel.vue";
import type { AiStatus, Dashboard, Family, FamilyMember, Location, OcrStatus, SessionUser, StoragePlace, SystemStatus } from "../types/api";

type ProfileSection = "family" | "locations" | "ai" | "push" | "runtime";
type ManageMode =
  | "create-family"
  | "rename-family"
  | "create-location"
  | "rename-location"
  | "create-storage-place"
  | "rename-storage-place";

const props = defineProps<{
  profileName: string;
  profileUid: string | null;
  profileRoleLabel: string;
  session: SessionUser | null;
  currentFamily: Family | null;
  families: Family[];
  familyMembers: Record<string, FamilyMember[]>;
  canManageFamily: boolean;
  expandedProfileSection: ProfileSection | null;
  expandedFamilyTreeId: string;
  selectedFamilyId: string;
  dashboard: Dashboard | null;
  refreshing: boolean;
  ocrStatus: OcrStatus | null;
  aiStatus: AiStatus | null;
  systemStatus: SystemStatus | null;
}>();

const emit = defineEmits<{
  (event: "toggle-profile-section", section: ProfileSection): void;
  (event: "toggle-family-tree", familyId: string): void;
  (event: "open-management", mode: ManageMode, target?: { id: string; name: string; parentName?: string }): void;
  (event: "open-member", family: Family): void;
  (event: "remove-member", member: FamilyMember): void;
  (event: "remove-location", location: Location): void;
  (event: "remove-storage-place", place: StoragePlace, location: Location): void;
  (event: "refresh-runtime"): void;
}>();

const profileInitial = computed(() => props.profileName.slice(0, 1) || "家");

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

const totalStoragePlaceCount = computed(() =>
  (props.currentFamily?.locations || []).reduce((sum, loc) => sum + (loc.storagePlaces?.length || 0), 0)
);

function memberRoleLabel(role: FamilyMember["role"]) {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}

function familyRoleLabel(role: string) {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}

function locationInventoryCount(locationId: string) {
  return props.dashboard?.locationBatchCounts?.[locationId] || 0;
}
</script>

<template>
  <div class="profile-page">
    <section class="data-section profile-card">
      <div class="profile-avatar">{{ profileInitial }}</div>
      <div class="profile-main">
        <strong>{{ profileName }}</strong>
        <span>{{ session?.authenticated ? "统一网关" : "本地开发" }} · {{ profileUid }} · {{ currentFamily?.name || "未选择家庭" }}</span>
      </div>
      <span class="role-chip">{{ profileRoleLabel }}</span>
    </section>

    <section class="profile-accordion" aria-label="我的配置">
      <article v-if="canManageFamily" class="data-section profile-accordion-item">
        <button
          class="profile-entry"
          :class="{ expanded: expandedProfileSection === 'family' }"
          type="button"
          :aria-expanded="expandedProfileSection === 'family'"
          aria-controls="profile-family-management"
          @click="emit('toggle-profile-section', 'family')"
        >
          <ShieldCheck :size="19" />
          <div>
            <strong>家庭分组</strong>
            <span>{{ families.length }} 个家庭，可管理分组与成员归属</span>
          </div>
          <ChevronDown :size="16" />
        </button>

        <section v-if="expandedProfileSection === 'family'" id="profile-family-management" class="profile-panel family-panel">
          <header class="section-heading">
            <div>
              <h2>家庭分组</h2>
              <p>当前账号已加入 {{ families.length }} 个家庭</p>
            </div>
            <button class="secondary-action" type="button" @click="emit('open-management', 'create-family')">
              <Plus :size="16" />
              新增家庭
            </button>
          </header>

          <div class="family-tree">
            <article v-for="family in families" :key="family.id" class="family-tree-node">
              <button class="family-tree-row" type="button" @click="emit('toggle-family-tree', family.id)">
                <ChevronDown :class="{ expanded: expandedFamilyTreeId === family.id }" :size="16" />
                <div class="family-avatar"><Home :size="20" /></div>
                <div class="family-summary-main">
                  <strong>{{ family.name }}</strong>
                  <span>{{ family.memberCount }} 位成员 · {{ family.locations.length }} 个地点</span>
                </div>
                <span class="role-chip">{{ familyRoleLabel(family.role) }}</span>
                <span v-if="family.id === selectedFamilyId" class="default-chip">当前</span>
              </button>

              <div v-if="expandedFamilyTreeId === family.id" class="family-tree-children">
                <div class="family-tree-toolbar">
                  <button class="secondary-action" type="button" @click="emit('open-management', 'rename-family', { id: family.id, name: family.name })">
                    <Pencil :size="16" />
                    重命名分组
                  </button>
                  <button class="secondary-action" type="button" @click="emit('open-member', family)">
                    <Plus :size="16" />
                    添加成员
                  </button>
                </div>

                <div class="member-management">
                  <header class="member-management-heading">
                    <div>
                      <h3>已加入成员</h3>
                      <p>“{{ family.name }}”下的成员列表</p>
                    </div>
                  </header>

                  <div class="member-list">
                    <article v-for="member in familyMembers[family.id] || []" :key="member.userId">
                      <div class="member-avatar"><UserRound :size="18" /></div>
                      <div class="member-main">
                        <strong>{{ member.displayName }}</strong>
                        <span>{{ member.userId }}</span>
                      </div>
                      <span class="role-chip">{{ memberRoleLabel(member.role) }}</span>
                      <button
                        v-if="member.role !== 'owner'"
                        class="icon-button subtle danger-button"
                        type="button"
                        :aria-label="`移除 ${member.displayName}`"
                        :title="`移除 ${member.displayName}`"
                        @click="emit('remove-member', member)"
                      >
                        <Trash2 :size="16" />
                      </button>
                    </article>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>
      </article>

      <article class="data-section profile-accordion-item">
        <button
          class="profile-entry"
          :class="{ expanded: expandedProfileSection === 'locations' }"
          type="button"
          :aria-expanded="expandedProfileSection === 'locations'"
          aria-controls="profile-locations"
          @click="emit('toggle-profile-section', 'locations')"
        >
          <MapPinned :size="19" />
          <div>
            <strong>房屋地点与存放位置</strong>
            <span>{{ currentFamily?.locations.length || 0 }} 个地点 · {{ totalStoragePlaceCount }} 个细分存放位置</span>
          </div>
          <ChevronDown :size="16" />
        </button>

        <section v-if="expandedProfileSection === 'locations'" id="profile-locations" class="profile-panel location-panel">
          <header class="section-heading">
            <div>
              <h2>房屋地点与细分位置</h2>
              <p>为每个地点配置柜子、冰箱、药箱、储物层架等具体存放位置，方便全家找东西</p>
            </div>
            <button class="secondary-action" type="button" @click="emit('open-management', 'create-location')">
              <MapPin :size="16" />
              新增地点
            </button>
          </header>

          <div class="location-list">
            <div v-for="location in currentFamily?.locations || []" :key="location.id" class="location-card-group">
              <article>
                <div class="location-icon"><Home v-if="location.kind === 'home'" :size="20" /><MapPin v-else :size="20" /></div>
                <div class="location-main">
                  <div>
                    <strong>{{ location.name }}</strong>
                    <span v-if="location.isDefault" class="default-chip">默认</span>
                  </div>
                  <span>{{ locationInventoryCount(location.id) }} 个有效批次 · {{ location.storagePlaces?.length || 0 }} 个细分位置</span>
                </div>
                <div class="location-actions">
                  <button
                    class="secondary-action compact-add-place"
                    type="button"
                    @click="emit('open-management', 'create-storage-place', { id: location.id, name: '', parentName: location.name })"
                  >
                    <Plus :size="14" />
                    细分位置
                  </button>
                  <button
                    class="icon-button subtle"
                    type="button"
                    :aria-label="`重命名 ${location.name}`"
                    :title="`重命名 ${location.name}`"
                    @click="emit('open-management', 'rename-location', location)"
                  >
                    <Pencil :size="16" />
                  </button>
                  <button
                    class="icon-button subtle danger-button"
                    type="button"
                    :aria-label="`删除 ${location.name}`"
                    :title="`删除 ${location.name}`"
                    @click="emit('remove-location', location)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </article>

              <div v-if="location.storagePlaces?.length" class="storage-places-row">
                <span v-for="place in location.storagePlaces" :key="place.id" class="storage-place-tag">
                  <span>{{ place.name }}</span>
                  <button
                    type="button"
                    :aria-label="`重命名 ${place.name}`"
                    :title="`重命名 ${place.name}`"
                    @click="emit('open-management', 'rename-storage-place', { id: place.id, name: place.name, parentName: location.name })"
                  >
                    <Pencil :size="12" />
                  </button>
                  <button
                    type="button"
                    class="danger"
                    :aria-label="`删除 ${place.name}`"
                    :title="`删除 ${place.name}`"
                    @click="emit('remove-storage-place', place, location)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </span>
              </div>
            </div>
          </div>
        </section>
      </article>

      <article v-if="canManageFamily" class="data-section profile-accordion-item">
        <button
          class="profile-entry"
          :class="{ expanded: expandedProfileSection === 'push' }"
          type="button"
          :aria-expanded="expandedProfileSection === 'push'"
          aria-controls="profile-push-settings"
          @click="emit('toggle-profile-section', 'push')"
        >
          <BellRing :size="19" />
          <div>
            <strong>外部推送提醒</strong>
            <span>企微 / 飞书 / 钉钉 / Bark / Webhook 定时发送临期与低库存摘要</span>
          </div>
          <ChevronDown :size="16" />
        </button>

        <div v-if="expandedProfileSection === 'push'" id="profile-push-settings" class="profile-panel">
          <PushSettingsPanel :families="families" />
        </div>
      </article>

      <article class="data-section profile-accordion-item">
        <button
          class="profile-entry"
          :class="{ expanded: expandedProfileSection === 'runtime' }"
          type="button"
          :aria-expanded="expandedProfileSection === 'runtime'"
          aria-controls="profile-runtime-status"
          @click="emit('toggle-profile-section', 'runtime')"
        >
          <Database :size="19" />
          <div>
            <strong>运行状态</strong>
            <span>{{ gatewayModeLabel }} · {{ aiProviderStatusLabel }}</span>
          </div>
          <ChevronDown :size="16" />
        </button>

        <RuntimeStatusPanel
          v-if="expandedProfileSection === 'runtime'"
          id="profile-runtime-status"
          :ocr-status="ocrStatus"
          :ai-status="aiStatus"
          :system-status="systemStatus"
          :refreshing="refreshing"
          @refresh="emit('refresh-runtime')"
        />
      </article>

      <article v-if="canManageFamily" class="data-section profile-accordion-item">
        <button
          class="profile-entry"
          :class="{ expanded: expandedProfileSection === 'ai' }"
          type="button"
          :aria-expanded="expandedProfileSection === 'ai'"
          aria-controls="profile-ai-settings"
          @click="emit('toggle-profile-section', 'ai')"
        >
          <Bot :size="19" />
          <div>
            <strong>AI 设置</strong>
            <span>DeepSeek/Kimi/GLM/Qwen 接入与结构化识别配置</span>
          </div>
          <ChevronDown :size="16" />
        </button>

        <div v-if="expandedProfileSection === 'ai'" id="profile-ai-settings" class="profile-panel ai-profile-panel">
          <AiSettingsPanel />
        </div>
      </article>
    </section>
  </div>
</template>
