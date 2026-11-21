import { computed, ref } from "vue";
import { request } from "../utils/api";
import type {
  Category,
  Dashboard,
  Family,
  FamilyMember,
  AiStatus,
  IntakeDraft,
  InventoryHistoryItem,
  OcrStatus,
  SessionUser,
  SystemStatus
} from "../types/api";

const loading = ref(true);
const refreshing = ref(false);
const serverOnline = ref(true);
const error = ref("");
const families = ref<Family[]>([]);
const familyMembers = ref<Record<string, FamilyMember[]>>({});
const categories = ref<Category[]>([]);
const dashboard = ref<Dashboard | null>(null);
const inventoryHistory = ref<InventoryHistoryItem[]>([]);
const intakeDrafts = ref<IntakeDraft[]>([]);
const ocrStatus = ref<OcrStatus | null>(null);
const aiStatus = ref<AiStatus | null>(null);
const systemStatus = ref<SystemStatus | null>(null);
const session = ref<SessionUser | null>(null);
const selectedFamilyId = ref("");
const selectedLocationId = ref("");
const selectedStoragePlaceId = ref("");
const inventoryStock = ref<"" | "low">("");
const dataVersion = ref(0);

const inventoryPageSize = 20;

const currentFamily = computed(
  () => families.value.find((family) => family.id === selectedFamilyId.value) || families.value[0] || null
);

const currentLocationName = computed(() => {
  if (!selectedLocationId.value) return "全部地点";
  return currentFamily.value?.locations.find((location) => location.id === selectedLocationId.value)?.name || "全部地点";
});

const canManageFamily = computed(() => {
  return session.value?.isAdmin || ["owner", "admin"].includes(currentFamily.value?.role || "");
});

const profileName = computed(() => session.value?.username || "本地用户");
const profileUid = computed(() => session.value?.uid || "local-owner");
const profileRoleLabel = computed(() => (canManageFamily.value ? "管理员" : "普通成员"));

function notifyDataChanged() {
  dataVersion.value += 1;
}

async function loadSession() {
  session.value = await request<SessionUser>("session");
}

async function loadFamilies(preferredFamilyId?: string) {
  const familyData = await request<Family[]>("families");
  families.value = familyData;
  const nextFamilyId =
    preferredFamilyId && familyData.some((family) => family.id === preferredFamilyId)
      ? preferredFamilyId
      : selectedFamilyId.value && familyData.some((family) => family.id === selectedFamilyId.value)
        ? selectedFamilyId.value
        : familyData[0]?.id || "";
  selectedFamilyId.value = nextFamilyId;
}

async function loadCategories() {
  categories.value = await request<Category[]>("categories");
  return categories.value;
}

async function loadDashboard(options: { appendInventory?: boolean; search?: string; showRefreshing?: boolean } = {}) {
  if (!selectedFamilyId.value) {
    dashboard.value = null;
    return;
  }

  const appendInventory = options.appendInventory === true;
  const inventoryOffset = appendInventory ? dashboard.value?.inventory.length || 0 : 0;
  if (options.showRefreshing !== false) refreshing.value = true;
  try {
    const params = new URLSearchParams({ familyId: selectedFamilyId.value });
    params.set("inventoryLimit", String(inventoryPageSize));
    params.set("inventoryOffset", String(inventoryOffset));
    if (options.search) params.set("search", options.search);
    if (selectedLocationId.value) params.set("locationId", selectedLocationId.value);
    if (selectedStoragePlaceId.value) params.set("storagePlaceId", selectedStoragePlaceId.value);
    if (inventoryStock.value) params.set("stock", inventoryStock.value);
    const nextDashboard = await request<Dashboard>(`dashboard?${params.toString()}`);
    dashboard.value = appendInventory && dashboard.value
      ? { ...nextDashboard, inventory: [...dashboard.value.inventory, ...nextDashboard.inventory] }
      : nextDashboard;
  } finally {
    if (options.showRefreshing !== false) refreshing.value = false;
  }
}

async function loadInventoryHistory() {
  if (!selectedFamilyId.value) {
    inventoryHistory.value = [];
    return;
  }
  const params = new URLSearchParams({ familyId: selectedFamilyId.value });
  if (selectedLocationId.value) params.set("locationId", selectedLocationId.value);
  inventoryHistory.value = await request<InventoryHistoryItem[]>(`inventory/history?${params.toString()}`);
}

async function loadIntakes() {
  if (!selectedFamilyId.value) {
    intakeDrafts.value = [];
    return;
  }
  intakeDrafts.value = await request<IntakeDraft[]>(
    `intakes?${new URLSearchParams({ familyId: selectedFamilyId.value }).toString()}`
  );
}

async function loadOcrStatus() {
  ocrStatus.value = await request<OcrStatus>("ocr/status");
}

async function loadAiStatus() {
  aiStatus.value = await request<AiStatus>("ai/status");
}

async function loadSystemStatus() {
  systemStatus.value = await request<SystemStatus>("system");
}

async function loadFamilyMembers(familyId: string) {
  if (!familyId || !canManageFamily.value) return;
  familyMembers.value = {
    ...familyMembers.value,
    [familyId]: await request<FamilyMember[]>(`families/${familyId}/members`)
  };
}

async function refreshProcessingState() {
  if (!selectedFamilyId.value) return;
  await Promise.all([loadIntakes(), loadOcrStatus(), loadAiStatus()]);
}

function clearFamilyScopedState() {
  selectedLocationId.value = "";
  selectedStoragePlaceId.value = "";
  familyMembers.value = {};
}

export function useAppContext() {
  return {
    loading,
    refreshing,
    serverOnline,
    error,
    families,
    familyMembers,
    categories,
    dashboard,
    inventoryHistory,
    intakeDrafts,
    ocrStatus,
    aiStatus,
    systemStatus,
    session,
    selectedFamilyId,
    selectedLocationId,
    selectedStoragePlaceId,
    inventoryStock,
    dataVersion,
    currentFamily,
    currentLocationName,
    canManageFamily,
    profileName,
    profileUid,
    profileRoleLabel,
    inventoryPageSize,
    notifyDataChanged,
    loadSession,
    loadFamilies,
    loadCategories,
    loadDashboard,
    loadInventoryHistory,
    loadIntakes,
    loadOcrStatus,
    loadAiStatus,
    loadSystemStatus,
    loadFamilyMembers,
    refreshProcessingState,
    clearFamilyScopedState
  };
}
