<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteUpdate, onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import {
  ChevronLeft,
  Bell,
  Boxes,
  CheckCircle2,
  Database,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert
} from "@lucide/vue";
import PageSkeleton from "../components/PageSkeleton.vue";
import ExpiryPage from "../components/ExpiryPage.vue";
import HistoryPage from "../components/HistoryPage.vue";
import InventoryEditModal from "../components/InventoryEditModal.vue";
import InventoryOperationModal from "../components/InventoryOperationModal.vue";
import InventoryPage from "../components/InventoryPage.vue";
import IntakeTasksView from "../components/IntakeTasksView.vue";
import ManagementModal from "../components/ManagementModal.vue";
import ManualIntakeModal from "../components/ManualIntakeModal.vue";
import MemberDialog from "../components/MemberDialog.vue";
import MessagesModal from "../components/MessagesModal.vue";
import OverviewPage from "../components/OverviewPage.vue";
import PhotoIntakeModal from "../components/PhotoIntakeModal.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import ProfilePage from "../components/ProfilePage.vue";
import AppShell from "../layouts/AppShell.vue";
import { formatLongDate } from "../utils/format";
import { useConfirm } from "../composables/useConfirm";
import { useAppContext } from "../composables/useAppContext";
import { usePullRefresh } from "../composables/usePullRefresh";
import { useToast } from "../composables/useToast";
import { request } from "../utils/api";
import type { Family, FamilyMember, InventoryHistoryItem, InventoryItem, Location, LowStockItem, OcrStatus, StoragePlace } from "../types/api";

type ViewKey = "overview" | "inventory" | "history" | "expiry" | "intakes" | "locations";
type ProfileSection = "family" | "locations" | "ai" | "push" | "runtime" | "about" | "feedback" | "agent" | "agentLogs";
type ManageMode =
  | "create-family"
  | "rename-family"
  | "create-location"
  | "rename-location"
  | "create-storage-place"
  | "rename-storage-place";
type OperationType = "consume" | "discard" | "transfer" | "adjust";

const app = useAppContext();
const {
  loading,
  refreshing,
  serverOnline,
  error,
  families,
  familyMembers,
  categories,
  dashboard,
  inventoryHistory,
  historyPending,
  historyLoaded,
  historyError,
  intakeDrafts,
  ocrStatus,
  aiStatus,
  systemStatus,
  session,
  selectedFamilyId,
  selectedLocationId,
  selectedStoragePlaceId,
  inventoryStock,
  currentFamily,
  currentLocationName,
  canManageFamily,
  profileName,
  profileUid,
  profileRoleLabel
} = app;

const submitting = ref(false);
const quickActionBusyId = ref("");
const inventoryLoadingMore = ref(false);
const installingOcr = ref(false);
const runtimePending = ref(false);
const runtimeError = ref("");
const modalError = ref("");
const activeView = ref<ViewKey>("overview");
const expandedProfileSection = ref<ProfileSection | null>(null);
const expandedFamilyTreeId = ref("");
const searchQuery = ref("");
const intakeOpen = ref(false);
const photoIntakeOpen = ref(false);
const photoIntakeId = ref("");
const messagesOpen = ref(false);
const memberOpen = ref(false);
const memberTargetFamily = ref<Family | null>(null);
const manageOpen = ref(false);
const manageMode = ref<ManageMode>("create-location");
const manageTargetId = ref("");
const manageParentLocationName = ref("");
const manageName = ref("");
const manageKind = ref("home");
const operationOpen = ref(false);
const operationItem = ref<InventoryItem | null>(null);
const operationType = ref<OperationType>("consume");
const editOpen = ref(false);
const editItem = ref<InventoryItem | null>(null);
const operationForm = ref({
  quantity: 1,
  targetQuantity: 0,
  toLocationId: "",
  toStoragePlaceId: "",
  reason: ""
});
const editForm = ref({
  name: "",
  brand: "",
  categoryId: "",
  storagePlaceId: "",
  specification: "",
  ingredients: "",
  unit: "件",
  purchasedAt: "",
  productionDate: "",
  shelfLifeValue: "",
  shelfLifeUnit: "month",
  expirationDate: "",
  unitPrice: "",
  channel: "",
  lowStockThreshold: ""
});
const memberForm = ref({
  familyId: "",
  userId: "",
  displayName: "",
  role: "member"
});
let intakePollTimer: number | null = null;
let intakeSnapshot = "";
let editSnapshot = "";
let applyingIntakeDefaults = false;
const inventoryPageSize = 20;
let searchTimer: number | null = null;

const { toast, showToast, clearToast, triggerToastAction } = useToast();
const { confirmState, askConfirm, resolveConfirm } = useConfirm();
const {
  pullRefreshing,
  pullDistance,
  pullRefreshVisible,
  pullRefreshReady,
  pullRefreshLabel,
  onPullTouchStart,
  onPullTouchMove,
  onPullTouchEnd,
  onPullTouchCancel
} = usePullRefresh({
  canStart: () => !loading.value && !submitting.value,
  refresh: () => refreshCurrentView({ fromPull: true })
});

const route = useRoute();
const router = useRouter();
const viewPathMap: Record<ViewKey, string> = {
  overview: "/overview",
  inventory: "/inventory",
  history: "/history",
  expiry: "/expiry",
  intakes: "/intakes",
  locations: "/me"
};
const profileSectionPathMap: Record<ProfileSection, string> = {
  agent: "/me/agent",
  agentLogs: "/me/agent/logs",
  family: "/me/families",
  locations: "/me/locations",
  ai: "/me/ai",
  push: "/me/push",
  runtime: "/me/runtime",
  about: "/me/about",
  feedback: "/me/feedback"
};

function routeView() {
  const view = route.meta.view;
  return view === "overview" || view === "inventory" || view === "history" || view === "expiry" || view === "intakes" || view === "locations"
    ? view
    : "overview";
}

function routeProfileSection() {
  const section = route.meta.profileSection;
  return section === "family" || section === "locations" || section === "ai" || section === "push" || section === "runtime" || section === "about" || section === "feedback" || section === "agent" || section === "agentLogs"
    ? section
    : null;
}

function ensureProfileRouteReady() {
  const section = routeProfileSection();
  if (section === "family" && !expandedFamilyTreeId.value) {
    const firstFamilyId = families.value[0]?.id || "";
    if (firstFamilyId && canManageFamily.value) {
      void toggleFamilyTree(firstFamilyId);
    }
  }
}

activeView.value = routeView();
expandedProfileSection.value = routeProfileSection();

const today = new Date().toISOString().slice(0, 10);
const intakeForm = ref({
  productId: "",
  name: "",
  brand: "",
  categoryId: "",
  locationId: "",
  storagePlaceId: "",
  quantity: 1,
  unit: "件",
  specification: "",
  purchasedAt: today,
  expirationDate: "",
  unitPrice: "",
  channel: "",
  lowStockThreshold: ""
});

const selectedCategory = computed(
  () => categories.value.find((category) => category.id === intakeForm.value.categoryId) || null
);
const selectedEditCategory = computed(
  () => categories.value.find((category) => category.id === editForm.value.categoryId) || null
);
const currentLocationStoragePlaces = computed(() => {
  if (!selectedLocationId.value) return [];
  return currentFamily.value?.locations.find((location) => location.id === selectedLocationId.value)?.storagePlaces || [];
});
const editItemStoragePlaces = computed(() => {
  if (!editItem.value) return [];
  return currentFamily.value?.locations.find((location) => location.id === editItem.value?.locationId)?.storagePlaces || [];
});

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

function matchesSearch(item: InventoryItem) {
  if (!normalizedSearch.value) {
    return true;
  }

  return [item.name, item.brand, item.specification, item.categoryName, item.locationName, item.storagePlaceName]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalizedSearch.value));
}

const filteredInventory = computed(() => (dashboard.value?.inventory || []).filter(matchesSearch));
const inventoryHasMore = computed(() => Boolean(dashboard.value?.inventoryHasMore));
const inventoryVisibleCount = computed(() => filteredInventory.value.length);
const filteredExpiring = computed(() => (dashboard.value?.expiring || []).filter(matchesSearch));
const filteredHistory = computed(() =>
  inventoryHistory.value.filter((item) => {
    if (!normalizedSearch.value) return true;
    return [
      item.name,
      item.brand,
      item.categoryName,
      item.fromLocationName,
      item.toLocationName,
      item.operatorName,
      item.operatorUserId,
      item.reason
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch.value));
  })
);
const availableTransferLocations = computed(
  () => currentFamily.value?.locations.filter((location) => location.id !== operationItem.value?.locationId) || []
);

const intakeDirty = computed(() => intakeOpen.value && JSON.stringify(intakeForm.value) !== intakeSnapshot);

const viewTitle = computed(() => {
  if (activeView.value === "locations" && expandedProfileSection.value) return { family: "家庭分组", locations: "房屋与存放位置", ai: "AI 设置", push: "推送提醒", runtime: "运行状态", about: "关于", feedback: "反馈与进度", agent: "Agent 接入", agentLogs: "调用记录" }[expandedProfileSection.value];
  if (activeView.value === "inventory") {
    return "全部库存";
  }
  if (activeView.value === "history") {
    return "历史物品";
  }
  if (activeView.value === "expiry") {
    return "临期管理";
  }
  if (activeView.value === "locations") {
    return "我的";
  }
  if (activeView.value === "intakes") {
    return "拍照录入任务";
  }
  return "库存概览";
});

const viewDescription = computed(() => {
  if (!currentFamily.value) {
    return session.value?.isAdmin ? "当前账号尚未创建或加入家庭分组" : "当前账号尚未加入任何家庭分组";
  }
  if (activeView.value === "inventory") {
    return `${currentFamily.value?.name || "家庭"} · ${currentLocationName.value}`;
  }
  if (activeView.value === "history") {
    return `已耗尽、已丢弃或已转移的历史物品 · ${currentLocationName.value}`;
  }
  if (activeView.value === "expiry") {
    return "按到期时间处理需要关注的批次";
  }
  if (activeView.value === "locations") {
    return "个人信息、房屋地点与家庭管理入口";
  }
  if (activeView.value === "intakes") {
    return "图片上传后由后台依次完成 OCR 与字段整理";
  }
  return `${currentFamily.value?.name || "家庭"} · ${currentLocationName.value}`;
});

const searchEnabled = computed(() => ["overview", "inventory", "history", "expiry"].includes(activeView.value));
const searchPlaceholder = computed(() => {
  if (activeView.value === "overview") return "搜家里有没有";
  if (activeView.value === "history") return "搜索历史物品、品牌或地点";
  if (activeView.value === "expiry") return "搜索临期商品、品牌或地点";
  return "搜索商品、品牌或存放位置";
});

async function loadDashboard(showRefreshing = true, options: { appendInventory?: boolean } = {}) {
  await app.loadDashboard({
    appendInventory: options.appendInventory,
    search: normalizedSearch.value,
    showRefreshing
  });
}

async function loadMoreInventory() {
  if (inventoryLoadingMore.value || refreshing.value || loading.value || activeView.value !== "inventory") return;
  if (!dashboard.value?.inventoryHasMore) return;

  inventoryLoadingMore.value = true;
  try {
    await loadDashboard(false, { appendInventory: true });
  } catch (err) {
    showToast(err instanceof Error ? err.message : "加载更多失败", "error");
  } finally {
    inventoryLoadingMore.value = false;
  }
}

async function loadInventoryHistory() {
  await app.loadInventoryHistory();
}

async function loadIntakes() {
  await app.loadIntakes();
}

async function loadOcrStatus() {
  await app.loadOcrStatus();
}

async function loadAiStatus() {
  await app.loadAiStatus();
}

async function loadSystemStatus() {
  await app.loadSystemStatus();
}

async function loadRuntimeStatus() {
  if (runtimePending.value) return;
  runtimePending.value = true;
  runtimeError.value = "";
  try { await Promise.all([loadOcrStatus(), loadAiStatus(), loadSystemStatus()]); }
  catch (err) { runtimeError.value = err instanceof Error ? err.message : "运行状态更新失败"; }
  finally { runtimePending.value = false; }
}

async function installOcrRuntime() {
  if (!session.value?.isAdmin || installingOcr.value || ocrStatus.value?.installer?.running) return;
  installingOcr.value = true;
  try {
    const result = await request<{ installer: NonNullable<OcrStatus["installer"]> }>("ocr/install", { method: "POST" });
    ocrStatus.value = {
      ...(ocrStatus.value || {
        worker: { state: "unchecked", ready: false, running: false, engine: null, modelVersion: null, errorMessage: null },
        queue: { queued: 0, processing: 0, failed: 0 }
      }),
      installer: result.installer
    };
    showToast(result.installer.running ? "OCR 环境开始安装" : "OCR 环境已就绪", "dark");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "OCR 环境安装启动失败", "error");
  } finally {
    installingOcr.value = false;
    void loadOcrStatus();
  }
}

async function loadSession() {
  await app.loadSession();
}

async function refreshProcessingState() {
  try {
    await app.refreshProcessingState();
  } catch {
    // Inventory remains usable when OCR runtime diagnostics are temporarily unavailable.
  }
}

async function guarded(load: () => Promise<void>) {
  try {
    await load();
    serverOnline.value = true;
  } catch (err) {
    serverOnline.value = false;
    error.value = err instanceof Error ? err.message : "数据加载失败";
    showToast(error.value, "error");
  }
}

async function loadFamilies(preferredFamilyId?: string) {
  await app.loadFamilies(preferredFamilyId);
}

async function refreshCurrentView(options: { fromPull?: boolean } = {}) {
  if (loading.value || refreshing.value || (pullRefreshing.value && !options.fromPull)) return;
  refreshing.value = true;
  error.value = "";
  try {
    const previousFamilyId = selectedFamilyId.value;
    const [categoryData] = await Promise.all([
      app.loadCategories(),
      loadSession(),
      loadFamilies(previousFamilyId)
    ]);
    if (!intakeForm.value.categoryId && categoryData[0]) {
      intakeForm.value.categoryId = categoryData[0].id;
    }

    if (selectedFamilyId.value) {
      await Promise.all([
        loadDashboard(false),
        activeView.value === "history" ? loadInventoryHistory() : Promise.resolve(),
        loadIntakes(),
        loadRuntimeStatus(),
        activeView.value === "locations" && expandedFamilyTreeId.value && canManageFamily.value
          ? loadFamilyMembers(expandedFamilyTreeId.value)
          : Promise.resolve()
      ]);
    } else {
      dashboard.value = null;
      intakeDrafts.value = [];
    }

    serverOnline.value = true;
    showToast("已刷新", "dark");
  } catch (err) {
    serverOnline.value = false;
    error.value = err instanceof Error ? err.message : "刷新失败，当前显示上次的内容";
    showToast(error.value, "error");
  } finally {
    refreshing.value = false;
  }
}

async function loadFamilyMembers(familyId: string) {
  await app.loadFamilyMembers(familyId);
}

async function toggleFamilyTree(familyId: string) {
  const nextFamilyId = expandedFamilyTreeId.value === familyId ? "" : familyId;
  expandedFamilyTreeId.value = nextFamilyId;
  if (nextFamilyId) {
    memberForm.value.familyId = nextFamilyId;
    modalError.value = "";
    await loadFamilyMembers(nextFamilyId);
  }
}

async function loadApp() {
  loading.value = !dashboard.value;
  error.value = "";

  try {
    const [, categoryData] = await Promise.all([
      loadFamilies(),
      app.loadCategories(),
      loadSession()
    ]);
    intakeForm.value.categoryId = categoryData[0]?.id || "";
    ensureProfileRouteReady();
    await loadDashboard();
    if (activeView.value === "history") void loadInventoryHistory();
    void guarded(loadIntakes);
    serverOnline.value = true;
    void guarded(loadRuntimeStatus);
  } catch (err) {
    serverOnline.value = false;
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function applyView(view: ViewKey, profileSection: ProfileSection | null = null) {
  activeView.value = view;
  if (!["inventory", "history", "expiry"].includes(view)) {
    searchQuery.value = "";
  }
  if (view === "locations") {
    expandedProfileSection.value = profileSection;
    if (profileSection === "runtime") {
      void guarded(loadRuntimeStatus);
    }
  }
  if (view === "history") {
    void guarded(loadInventoryHistory);
  } else if (view === "inventory") {
    void nextTick(() => onWindowScroll());
  }
}

function clearInventoryStock() {
  if (!inventoryStock.value) return;
  inventoryStock.value = "";
  void guarded(() => loadDashboard());
}

function openLowStock() {
  inventoryStock.value = "low";
  const needsReload = !selectedLocationId.value && !selectedStoragePlaceId.value && !searchQuery.value;
  selectedLocationId.value = "";
  selectedStoragePlaceId.value = "";
  searchQuery.value = "";
  setView("inventory");
  if (needsReload) {
    void guarded(() => loadDashboard());
  }
}

function setView(view: ViewKey) {
  const target = viewPathMap[view];
  if (route.path !== target) {
    void router.push(target);
    return;
  }
  applyView(view);
}

function toggleProfileSection(section: ProfileSection) {
  const nextSection = expandedProfileSection.value === section ? null : section;
  const target = nextSection ? profileSectionPathMap[nextSection] : "/me";
  if (route.path !== target) {
    void router.push(target);
    return;
  }
  expandedProfileSection.value = nextSection;
  if (nextSection === "family" && !expandedFamilyTreeId.value) {
    const firstFamilyId = families.value[0]?.id || "";
    if (firstFamilyId) {
      void toggleFamilyTree(firstFamilyId);
    }
  } else if (nextSection === "runtime") {
    void guarded(loadRuntimeStatus);
  }
}

function openIntake(preset?: Partial<typeof intakeForm.value>) {
  const defaultLocation =
    currentFamily.value?.locations.find((location) => location.isDefault) || currentFamily.value?.locations[0];
  const defaultCategory = categories.value[0];
  applyingIntakeDefaults = true;
  intakeForm.value = {
    productId: preset?.productId || "",
    name: preset?.name || "",
    brand: preset?.brand || "",
    categoryId: preset?.categoryId || defaultCategory?.id || "",
    locationId: preset?.locationId || selectedLocationId.value || defaultLocation?.id || "",
    storagePlaceId: preset?.storagePlaceId ?? selectedStoragePlaceId.value ?? "",
    quantity: preset?.quantity || 1,
    unit: preset?.unit || defaultCategory?.fields.defaultUnit || "件",
    specification: preset?.specification || "",
    purchasedAt: today,
    expirationDate: "",
    unitPrice: preset?.unitPrice || "",
    channel: preset?.channel || "",
    lowStockThreshold: preset?.lowStockThreshold || ""
  };
  modalError.value = "";
  intakeOpen.value = true;
  // Snapshot after the category watcher settles so the dirty check starts clean.
  void nextTick(() => {
    applyingIntakeDefaults = false;
    intakeSnapshot = JSON.stringify(intakeForm.value);
  });
}

function restockFromLowStock(item: LowStockItem) {
  openIntake({
    productId: item.productId,
    name: item.name,
    brand: item.brand || "",
    categoryId: item.categoryId || categories.value[0]?.id || "",
    specification: item.specification || "",
    unit: item.unit || "件",
    lowStockThreshold: String(item.threshold)
  });
}

function restockFromHistory(item: InventoryHistoryItem) {
  const matchedCategory = categories.value.find((cat) => cat.key === item.categoryKey || cat.name === item.categoryName);
  openIntake({
    productId: item.productId,
    name: item.name,
    brand: item.brand || "",
    categoryId: matchedCategory?.id || categories.value[0]?.id || "",
    locationId: item.toLocationId || item.fromLocationId || "",
    unit: item.unit || "件",
    unitPrice: item.unitPrice !== null ? String(item.unitPrice) : "",
    channel: item.channel || ""
  });
}

function restockFromOperation() {
  if (!operationItem.value || submitting.value) return;
  const item = operationItem.value;
  operationOpen.value = false;
  openIntake({
    productId: item.productId,
    name: item.name,
    brand: item.brand || "",
    categoryId: item.categoryId,
    locationId: item.locationId,
    storagePlaceId: item.storagePlaceId || "",
    specification: item.specification || "",
    unit: item.unit,
    unitPrice: item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : "",
    channel: item.channel || "",
    lowStockThreshold:
      item.lowStockThreshold !== null && item.lowStockThreshold !== undefined ? String(item.lowStockThreshold) : ""
  });
}

function selectLocation(locationId: string) {
  selectedLocationId.value = locationId;
}

async function handleStoragePlaceCreated() {
  await loadFamilies(selectedFamilyId.value);
  showToast("位置已记下");
}

function handlePhotoNextSaved() {
  showToast("当前草稿已转入后台识别，请拍下一件", "dark");
}

function openPhotoIntake(intakeId = "") {
  photoIntakeId.value = intakeId;
  photoIntakeOpen.value = true;
}

function openMessageIntake(intakeId: string) {
  messagesOpen.value = false;
  openPhotoIntake(intakeId);
}

function switchToPhotoIntake() {
  if (submitting.value) return;
  intakeOpen.value = false;
  openPhotoIntake();
}

function closePhotoIntake() {
  photoIntakeOpen.value = false;
  photoIntakeId.value = "";
  void refreshProcessingState();
}

async function handlePhotoCompleted() {
  showToast("商品已入库");
  await Promise.all([loadDashboard(), loadIntakes()]);
}

async function attemptCloseIntake() {
  if (submitting.value) return;
  if (intakeDirty.value) {
    const confirmed = await askConfirm({
      title: "放弃未保存的内容？",
      message: "表单已填写部分内容，关闭后将会丢失。",
      confirmText: "放弃填写",
      danger: true
    });
    if (!confirmed) return;
  }
  intakeOpen.value = false;
}

async function submitIntake() {
  if (submitting.value) return;
  submitting.value = true;
  modalError.value = "";

  try {
    await request("inventory/intakes", {
      method: "POST",
      body: JSON.stringify({
        ...intakeForm.value,
        familyId: selectedFamilyId.value
      })
    });
    intakeOpen.value = false;
    showToast(`${intakeForm.value.name} 已入库`);
    await loadDashboard();
  } catch (err) {
    modalError.value = err instanceof Error ? err.message : "入库失败";
  } finally {
    submitting.value = false;
  }
}

function openManagement(mode: ManageMode, target?: { id: string; name: string; parentName?: string }) {
  manageMode.value = mode;
  manageTargetId.value = target?.id || "";
  manageParentLocationName.value = target?.parentName || "";
  manageName.value = target?.name || "";
  manageKind.value = "home";
  modalError.value = "";
  manageOpen.value = true;
}

function closeManagement() {
  if (!submitting.value) {
    manageOpen.value = false;
  }
}

async function submitManagement() {
  if (submitting.value) return;
  submitting.value = true;
  modalError.value = "";

  try {
    let preferredFamilyId = selectedFamilyId.value;
    if (manageMode.value === "create-family") {
      const result = await request<{ familyId: string }>("families", {
        method: "POST",
        body: JSON.stringify({ name: manageName.value })
      });
      preferredFamilyId = result.familyId;
      showToast("家庭已创建");
    } else if (manageMode.value === "rename-family") {
      await request(`families/${manageTargetId.value}`, {
        method: "PATCH",
        body: JSON.stringify({ name: manageName.value })
      });
      showToast("家庭名称已更新");
    } else if (manageMode.value === "create-location") {
      await request(`families/${selectedFamilyId.value}/locations`, {
        method: "POST",
        body: JSON.stringify({
          name: manageName.value,
          kind: manageKind.value
        })
      });
      showToast("地点已创建");
    } else if (manageMode.value === "rename-location") {
      await request(`locations/${manageTargetId.value}`, {
        method: "PATCH",
        body: JSON.stringify({ name: manageName.value })
      });
      showToast("地点名称已更新");
    } else if (manageMode.value === "create-storage-place") {
      await request(`locations/${manageTargetId.value}/storage-places`, {
        method: "POST",
        body: JSON.stringify({ name: manageName.value })
      });
      showToast("细分存放位置已创建");
    } else {
      await request(`storage-places/${manageTargetId.value}`, {
        method: "PATCH",
        body: JSON.stringify({ name: manageName.value })
      });
      showToast("存放位置名称已更新");
    }

    manageOpen.value = false;
    await loadFamilies(preferredFamilyId);
    await loadDashboard();
  } catch (err) {
    modalError.value = err instanceof Error ? err.message : "保存失败";
  } finally {
    submitting.value = false;
  }
}

function openMemberDialog(family: Family) {
  memberTargetFamily.value = family;
  memberForm.value = { familyId: family.id, userId: "", displayName: "", role: "member" };
  modalError.value = "";
  memberOpen.value = true;
}

function closeMemberDialog() {
  if (!submitting.value) {
    memberOpen.value = false;
    memberTargetFamily.value = null;
  }
}

async function addMemberToFamily() {
  if (submitting.value) return;
  const familyId = memberForm.value.familyId || expandedFamilyTreeId.value;
  if (!familyId) return;
  submitting.value = true;
  modalError.value = "";
  try {
    await request(`families/${familyId}/members`, {
      method: "POST",
      body: JSON.stringify(memberForm.value)
    });
    memberForm.value = { familyId, userId: "", displayName: "", role: "member" };
    await Promise.all([loadFamilyMembers(familyId), loadFamilies(selectedFamilyId.value)]);
    memberOpen.value = false;
    memberTargetFamily.value = null;
    showToast("成员已加入家庭分组");
  } catch (err) {
    modalError.value = err instanceof Error ? err.message : "添加成员失败";
  } finally {
    submitting.value = false;
  }
}

async function removeMemberFromFamily(member: FamilyMember) {
  const familyId = expandedFamilyTreeId.value;
  if (!familyId) return;
  const confirmed = await askConfirm({
    title: `移除“${member.displayName}”？`,
    message: "移除后该成员将不再属于当前家庭分组。",
    confirmText: "移除",
    danger: true
  });
  if (!confirmed) return;

  submitting.value = true;
  try {
    await request(`families/${familyId}/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" });
    await Promise.all([loadFamilyMembers(familyId), loadFamilies(selectedFamilyId.value)]);
    showToast("成员已移除");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "移除成员失败", "error");
  } finally {
    submitting.value = false;
  }
}

async function removeLocation(location: Location) {
  const confirmed = await askConfirm({
    title: `删除“${location.name}”？`,
    message: "仅当该地点下没有有效库存批次时才能删除，删除后不可恢复。",
    confirmText: "删除",
    danger: true
  });
  if (!confirmed) return;

  try {
    await request(`locations/${location.id}`, { method: "DELETE" });
    if (selectedLocationId.value === location.id) {
      selectedLocationId.value = "";
      selectedStoragePlaceId.value = "";
    }
    await loadFamilies(selectedFamilyId.value);
    await loadDashboard();
    showToast("地点已删除");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除失败", "error");
  }
}

async function removeStoragePlace(place: StoragePlace, location: Location) {
  const confirmed = await askConfirm({
    title: `删除“${location.name} · ${place.name}”？`,
    message: `已存放于此的物品将保留在“${location.name}”，仅清除细分位置标记。`,
    confirmText: "删除",
    danger: true
  });
  if (!confirmed) return;

  try {
    await request(`storage-places/${place.id}`, { method: "DELETE" });
    if (selectedStoragePlaceId.value === place.id) {
      selectedStoragePlaceId.value = "";
    }
    await loadFamilies(selectedFamilyId.value);
    await loadDashboard();
    showToast("细分位置已删除");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除失败", "error");
  }
}

async function quickConsume(item: InventoryItem, mode: "one" | "all") {
  if (quickActionBusyId.value) return;
  const quantity = mode === "one" ? Math.min(1, item.quantity) : item.quantity;
  if (mode === "all" && item.quantity > 1) {
    const confirmed = await askConfirm({
      title: `标记“${item.name}”已用完？`,
      message: `将一次性核销当前批次剩余的 ${item.quantity}${item.unit}，并移入历史物品。`,
      confirmText: "标记用完"
    });
    if (!confirmed) return;
  }

  quickActionBusyId.value = item.batchId;
  try {
    await request(`inventory/batches/${item.batchId}/operations`, {
      method: "POST",
      body: JSON.stringify({
        operationType: "consume",
        quantity,
        reason: mode === "one" ? "快捷消耗 -1" : "快捷标记用完"
      })
    });
    if (mode === "one") {
      const previousQuantity = item.quantity;
      showToast(`${item.name} 已 -1${item.unit}`, "success", {
        actionLabel: "撤销",
        durationMs: 5500,
        onAction: async () => {
          try {
            await request(`inventory/batches/${item.batchId}/operations`, {
              method: "POST",
              body: JSON.stringify({
                operationType: "adjust",
                targetQuantity: previousQuantity,
                reason: "撤销快捷消耗 -1"
              })
            });
            showToast(`已恢复 ${item.name} 库存为 ${previousQuantity}${item.unit}`, "dark");
            await loadDashboard(false);
          } catch (err) {
            showToast(err instanceof Error ? err.message : "撤销失败", "error");
          }
        }
      });
    } else {
      showToast(`${item.name} 已标记用完`);
    }
    await loadDashboard(false);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "快捷核销失败", "error");
  } finally {
    quickActionBusyId.value = "";
  }
}

function selectStoragePlace(storagePlaceId: string) {
  selectedStoragePlaceId.value = storagePlaceId;
}

function selectOperation(type: OperationType) {
  operationType.value = type;
  operationForm.value.reason = "";
  operationForm.value.quantity = 1;
  operationForm.value.targetQuantity = operationItem.value?.quantity || 0;
  operationForm.value.toLocationId = "";
  operationForm.value.toStoragePlaceId = "";
}

function openOperation(item: InventoryItem) {
  operationItem.value = item;
  operationOpen.value = true;
  modalError.value = "";
  selectOperation("consume");
}

function closeOperation() {
  if (!submitting.value) {
    operationOpen.value = false;
  }
}

function openEditInventory(item: InventoryItem) {
  editItem.value = item;
  editForm.value = {
    name: item.name,
    brand: item.brand || "",
    categoryId: item.categoryId,
    storagePlaceId: item.storagePlaceId || "",
    specification: item.specification || "",
    ingredients: item.ingredients || "",
    unit: item.unit,
    purchasedAt: item.purchasedAt || "",
    productionDate: item.productionDate || "",
    shelfLifeValue: item.shelfLifeValue ? String(item.shelfLifeValue) : "",
    shelfLifeUnit: item.shelfLifeUnit || "month",
    expirationDate: item.expirationDate || "",
    unitPrice: item.unitPrice !== null && item.unitPrice !== undefined ? String(item.unitPrice) : "",
    channel: item.channel || "",
    lowStockThreshold:
      item.lowStockThreshold !== null && item.lowStockThreshold !== undefined ? String(item.lowStockThreshold) : ""
  };
  modalError.value = "";
  editOpen.value = true;
  void nextTick(() => { editSnapshot = JSON.stringify(editForm.value); });
}

function openEditFromOperation() {
  if (!operationItem.value || submitting.value) return;
  const item = operationItem.value;
  operationOpen.value = false;
  openEditInventory(item);
}

async function closeEditInventory() {
  if (submitting.value || !await canDiscardEdit()) return;
  {
    editOpen.value = false;
    editItem.value = null;
  }
}

async function submitEditInventory() {
  if (submitting.value) return;
  if (!editItem.value) return;
  submitting.value = true;
  modalError.value = "";

  try {
    await request(`inventory/batches/${editItem.value.batchId}`, {
      method: "PATCH",
      body: JSON.stringify({
        ...editForm.value,
        shelfLifeValue: editForm.value.shelfLifeValue || null,
        shelfLifeUnit: editForm.value.shelfLifeValue ? editForm.value.shelfLifeUnit : null,
        unitPrice: editForm.value.unitPrice || null,
        lowStockThreshold: editForm.value.lowStockThreshold || null
      })
    });
    editOpen.value = false;
    editItem.value = null;
    showToast("库存信息已更新");
    await loadDashboard();
  } catch (err) {
    modalError.value = err instanceof Error ? err.message : "保存库存信息失败";
  } finally {
    submitting.value = false;
  }
}

async function submitOperation() {
  if (submitting.value) return;
  if (!operationItem.value) {
    return;
  }

  submitting.value = true;
  modalError.value = "";
  try {
    const body =
      operationType.value === "adjust"
        ? {
            operationType: operationType.value,
            targetQuantity: operationForm.value.targetQuantity,
            reason: operationForm.value.reason
          }
        : {
            operationType: operationType.value,
            quantity: operationForm.value.quantity,
            toLocationId: operationType.value === "transfer" ? operationForm.value.toLocationId : undefined,
            toStoragePlaceId: operationType.value === "transfer" ? operationForm.value.toStoragePlaceId || undefined : undefined,
            reason: operationForm.value.reason
          };

    await request(`inventory/batches/${operationItem.value.batchId}/operations`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const labels: Record<OperationType, string> = {
      consume: "库存已消耗",
      discard: "库存已丢弃",
      transfer: "库存已转移",
      adjust: "盘点数量已更新"
    };
    operationOpen.value = false;
    showToast(labels[operationType.value]);
    await loadDashboard();
  } catch (err) {
    modalError.value = err instanceof Error ? err.message : "库存操作失败";
  } finally {
    submitting.value = false;
  }
}

const editDirty = computed(() => editOpen.value && JSON.stringify(editForm.value) !== editSnapshot);
async function canDiscardEdit() {
  return !editDirty.value || await askConfirm({ title: "放弃未保存的修改？", message: "关闭后将丢失本次修改。", confirmText: "放弃修改", danger: true });
}
async function canLeaveWorkspace() {
  if (submitting.value) return false;
  if (!await canDiscardEdit()) return false;
  if (intakeDirty.value && !await askConfirm({ title: "放弃未保存的内容？", message: "离开后将丢失本次填写。", confirmText: "放弃填写", danger: true })) return false;
  intakeOpen.value = false;
  editOpen.value = false;
  return true;
}
onBeforeRouteLeave(canLeaveWorkspace);
onBeforeRouteUpdate(canLeaveWorkspace);
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!intakeDirty.value && !editDirty.value && !submitting.value) return;
  event.preventDefault(); event.returnValue = "";
}

function onVisibilityChange() {
  if (!document.hidden && !loading.value) {
    void refreshProcessingState();
  }
}

function onWindowScroll() {
  if (activeView.value !== "inventory" || !dashboard.value?.inventoryHasMore || inventoryLoadingMore.value) return;
  const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const pageHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight
  );
  if (pageHeight - (scrollTop + viewportHeight) < 260) {
    void loadMoreInventory();
  }
}

watch(selectedFamilyId, () => {
  error.value = "";
  dashboard.value = null;
  inventoryHistory.value = [];
  historyLoaded.value = false;
  intakeDrafts.value = [];
  selectedLocationId.value = "";
  selectedStoragePlaceId.value = "";
  familyMembers.value = {};
  if (loading.value) return;
  searchQuery.value = "";
  inventoryStock.value = "";
  expandedProfileSection.value = routeProfileSection();
  void guarded(async () => {
    await loadDashboard();
    if (activeView.value === "history") {
      await loadInventoryHistory();
    }
    if (expandedProfileSection.value === "family" && expandedFamilyTreeId.value && canManageFamily.value) {
      await loadFamilyMembers(expandedFamilyTreeId.value);
    }
    await refreshProcessingState();
  });
});

watch(selectedLocationId, () => {
  selectedStoragePlaceId.value = "";
  if (!loading.value) {
    void guarded(async () => {
      await loadDashboard();
      if (activeView.value === "history") {
        await loadInventoryHistory();
      }
    });
  }
});

watch(selectedStoragePlaceId, () => {
  if (!loading.value) {
    void guarded(async () => {
      await loadDashboard();
    });
  }
});

watch(normalizedSearch, () => {
  if (activeView.value === "overview" && normalizedSearch.value) {
    inventoryStock.value = "";
    setView("inventory");
  }
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (!loading.value && selectedFamilyId.value) {
      void guarded(async () => {
        await loadDashboard(false);
        if (activeView.value === "history") {
          await loadInventoryHistory();
        }
        await nextTick();
        onWindowScroll();
      });
    }
  }, 300);
});

watch(
  () => route.fullPath,
  () => {
    applyView(routeView(), routeProfileSection());
    ensureProfileRouteReady();
  }
);

watch(
  () => intakeForm.value.categoryId,
  () => {
    if (applyingIntakeDefaults || !selectedCategory.value) return;
    intakeForm.value.unit = selectedCategory.value.fields.defaultUnit;
    if (!selectedCategory.value.fields.expirationEnabled) {
      intakeForm.value.expirationDate = "";
    }
  }
);

watch(
  () => editForm.value.categoryId,
  () => {
    if (selectedEditCategory.value && !selectedEditCategory.value.fields.expirationEnabled) {
      editForm.value.productionDate = "";
      editForm.value.shelfLifeValue = "";
      editForm.value.shelfLifeUnit = "month";
      editForm.value.expirationDate = "";
    }
  }
);

onMounted(() => {
  void loadApp();
  intakePollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void refreshProcessingState();
  }, 8000);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("scroll", onWindowScroll, { passive: true });
});

onBeforeUnmount(() => {
  if (intakePollTimer) window.clearInterval(intakePollTimer);
  clearToast();
  if (searchTimer) window.clearTimeout(searchTimer);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.removeEventListener("scroll", onWindowScroll);
});
</script>

<template>
  <AppShell
    v-model:selected-family-id="selectedFamilyId"
    v-model:selected-location-id="selectedLocationId"
    v-model:search-query="searchQuery"
    :active-view="activeView"
    :families="families"
    :current-family="currentFamily"
    :dashboard="dashboard"
    :server-online="serverOnline"
    :search-enabled="searchEnabled"
    :search-placeholder="searchPlaceholder"
    @navigate="setView"
    @open-intake="openIntake"
    @open-photo-intake="openPhotoIntake()"
  >

      <div class="pull-refresh-indicator" :class="{ visible: pullRefreshVisible, ready: pullRefreshReady || pullRefreshing }">
        <LoaderCircle v-if="pullRefreshing" class="spin" :size="15" />
        <RotateCcw v-else :size="15" />
        <span>{{ pullRefreshLabel }}</span>
      </div>

      <div
        class="content"
        :style="{ transform: pullDistance ? `translateY(${Math.min(pullDistance, 76)}px)` : '' }"
        @touchstart.passive="onPullTouchStart"
        @touchmove="onPullTouchMove"
        @touchend="onPullTouchEnd"
        @touchcancel="onPullTouchCancel"
      >
        <header class="page-heading" :class="{ 'subpage-header': activeView === 'locations' && expandedProfileSection }">
          <button v-if="activeView === 'locations' && expandedProfileSection" class="back-button" type="button" :aria-label="expandedProfileSection === 'agentLogs' ? '返回 Agent 接入' : '返回我的'" @click="expandedProfileSection === 'agentLogs' ? router.push('/me/agent') : setView('locations')"><ChevronLeft :size="22" /></button>
          <div>
            <h1>{{ viewTitle }}</h1>
            <p v-if="activeView === 'locations' && expandedProfileSection === 'feedback'">让每一个问题都有后续</p>
            <p v-else-if="activeView !== 'locations' || !expandedProfileSection">{{ viewDescription }}</p>
          </div>
          <div class="page-heading-actions">
            <button
              v-if="activeView === 'locations' && !expandedProfileSection"
              class="heading-icon-button"
              type="button"
              aria-label="查看消息"
              title="查看消息"
              @click="messagesOpen = true"
            >
              <Bell :size="19" />
              <span v-if="dashboard?.summary.pendingCount" class="notification-dot"></span>
            </button>
            <button
              v-else-if="activeView === 'inventory'"
              class="heading-text-button"
              type="button"
              @click="setView('history')"
            >
              <Database :size="16" />
              <span>历史物品</span>
            </button>
            <button
              v-else-if="activeView === 'history'"
              class="heading-text-button"
              type="button"
              @click="setView('inventory')"
            >
              <Boxes :size="16" />
              <span>返回库存</span>
            </button>
            <span v-else class="date-label">{{ formatLongDate(new Date()) }}</span>
          </div>
        </header>

        <p v-if="error && dashboard" class="inline-error" role="alert">
          <TriangleAlert :size="16" />{{ error }} <button type="button" @click="refreshCurrentView()">重试</button>
        </p>

        <PageSkeleton v-if="loading || (!dashboard && families.length && !error)" :overview="activeView === 'overview'" />

        <div v-else-if="error && !dashboard" class="page-state error-state">
          <TriangleAlert :size="28" />
          <strong>{{ error }}</strong>
          <button type="button" @click="loadApp">重新加载</button>
        </div>

        <div v-else-if="!families.length" class="page-state no-family-state">
          <ShieldCheck :size="32" />
          <strong>尚未加入家庭分组</strong>
          <span v-if="session?.isAdmin">
            当前账号是 fnOS 管理员，可以先创建一个家庭分组，再添加家庭成员。
          </span>
          <span v-else>
            请将用户 ID「{{ profileUid }}」提供给家庭管理员，由管理员在“我的 / 家庭分组”中添加你。
          </span>
          <button
            v-if="session?.isAdmin"
            class="primary-button"
            type="button"
            @click="openManagement('create-family')"
          >
            <Plus :size="17" />
            创建第一个家庭
          </button>
        </div>

        <template v-else-if="dashboard">
          <OverviewPage
            v-if="activeView === 'overview'"
            :dashboard="dashboard"
            :recent-items="dashboard.recent.filter(matchesSearch)"
            :filtered="normalizedSearch.length > 0"
            :quick-action-busy-id="quickActionBusyId"
            @navigate="setView"
            @operate="openOperation"
            @quick-consume="quickConsume"
            @restock-low-stock="restockFromLowStock"
            @show-low-stock="openLowStock"
          />

          <InventoryPage
            v-else-if="activeView === 'inventory'"
            :items="filteredInventory"
            :filtered="normalizedSearch.length > 0"
            :inventory-count="dashboard.inventoryCount"
            :visible-count="inventoryVisibleCount"
            :has-more="inventoryHasMore"
            :loading-more="inventoryLoadingMore"
            :locations="currentFamily?.locations || []"
            :selected-location-id="selectedLocationId"
            :storage-places="currentLocationStoragePlaces"
            :selected-storage-place-id="selectedStoragePlaceId"
            :low-stock-only="inventoryStock === 'low'"
            :quick-action-busy-id="quickActionBusyId"
            @open-intake="openIntake()"
            @clear-stock-filter="clearInventoryStock"
            @load-more="loadMoreInventory"
            @operate="openOperation"
            @quick-consume="quickConsume"
            @select-location="selectLocation"
            @select-storage-place="selectStoragePlace"
          />

          <PageSkeleton v-else-if="activeView === 'history' && historyPending && !historyLoaded" />
          <HistoryPage
            v-else-if="activeView === 'history'"
            :items="filteredHistory"
            :error="historyError"
            :filtered="normalizedSearch.length > 0"
            :refreshing="historyPending"
            @refresh="loadInventoryHistory"
            @restock="restockFromHistory"
          />

          <ExpiryPage
            v-else-if="activeView === 'expiry'"
            :items="filteredExpiring"
            :filtered="normalizedSearch.length > 0"
            :quick-action-busy-id="quickActionBusyId"
            @operate="openOperation"
            @quick-consume="quickConsume"
          />

          <IntakeTasksView
            v-else-if="activeView === 'intakes'"
            :intake-drafts="intakeDrafts"
            :ocr-status="ocrStatus"
            :session="session"
            :refreshing="refreshing"
            :installing-ocr="installingOcr"
            @install-ocr="installOcrRuntime"
            @refresh-ocr="loadOcrStatus"
            @open-photo-intake="openPhotoIntake"
          />

          <ProfilePage
            v-else
            :profile-name="profileName"
            :profile-uid="profileUid"
            :profile-role-label="profileRoleLabel"
            :session="session"
            :current-family="currentFamily"
            :families="families"
            :family-members="familyMembers"
            :can-manage-family="canManageFamily"
            :expanded-profile-section="expandedProfileSection"
            :expanded-family-tree-id="expandedFamilyTreeId"
            :selected-family-id="selectedFamilyId"
            :dashboard="dashboard"
            :refreshing="refreshing"
            :ocr-status="ocrStatus"
            :ai-status="aiStatus"
            :system-status="systemStatus"
            :runtime-pending="runtimePending"
            :runtime-error="runtimeError"
            @toggle-profile-section="toggleProfileSection"
            @toggle-family-tree="toggleFamilyTree"
            @open-management="openManagement"
            @open-member="openMemberDialog"
            @remove-member="removeMemberFromFamily"
            @remove-location="removeLocation"
            @remove-storage-place="removeStoragePlace"
            @refresh-runtime="loadRuntimeStatus"
          />
        </template>
      </div>

    <PhotoIntakeModal
      :open="photoIntakeOpen"
      :family="currentFamily"
      :categories="categories"
      :selected-location-id="selectedLocationId"
      :intake-id="photoIntakeId"
      @close="closePhotoIntake"
      @updated="refreshProcessingState"
      @completed="handlePhotoCompleted"
      @storage-place-created="handleStoragePlaceCreated"
      @next-saved="handlePhotoNextSaved"
    />

    <ManualIntakeModal
      :open="intakeOpen"
      :form="intakeForm"
      :categories="categories"
      :locations="currentFamily?.locations || []"
      :submitting="submitting"
      :error="modalError"
      @close="attemptCloseIntake"
      @submit="submitIntake"
      @switch-photo="switchToPhotoIntake"
      @storage-place-created="handleStoragePlaceCreated"
    />

    <ManagementModal
      v-model:name="manageName"
      v-model:kind="manageKind"
      :open="manageOpen"
      :mode="manageMode"
      :current-family-name="currentFamily?.name"
      :parent-location-name="manageParentLocationName"
      :submitting="submitting"
      :error="modalError"
      @close="closeManagement"
      @submit="submitManagement"
    />

    <MemberDialog
      :open="memberOpen"
      :family="memberTargetFamily"
      :form="memberForm"
      :submitting="submitting"
      :error="modalError"
      @close="closeMemberDialog"
      @submit="addMemberToFamily"
    />

    <InventoryOperationModal
      :open="operationOpen"
      :item="operationItem"
      :operation-type="operationType"
      :form="operationForm"
      :available-transfer-locations="availableTransferLocations"
      :submitting="submitting"
      :error="modalError"
      @close="closeOperation"
      @submit="submitOperation"
      @select-operation="selectOperation"
      @edit-info="openEditFromOperation"
      @restock="restockFromOperation"
      @storage-place-created="handleStoragePlaceCreated"
    />

    <InventoryEditModal
      :open="editOpen"
      :item="editItem"
      :form="editForm"
      :categories="categories"
      :storage-places="editItemStoragePlaces"
      :submitting="submitting"
      :error="modalError"
      @close="closeEditInventory"
      @submit="submitEditInventory"
      @storage-place-created="handleStoragePlaceCreated"
    />

    <ConfirmDialog
      :open="!!confirmState"
      :title="confirmState?.title || ''"
      :message="confirmState?.message || ''"
      :confirm-text="confirmState?.confirmText"
      :danger="confirmState?.danger"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />

    <MessagesModal
      :open="messagesOpen"
      :intake-drafts="intakeDrafts"
      @close="messagesOpen = false"
      @open-intake="openMessageIntake"
    />

    <div v-if="toast" class="toast" :class="toast.type" role="status">
      <TriangleAlert v-if="toast.type === 'error'" :size="18" />
      <CheckCircle2 v-else :size="18" />
      <span>{{ toast.text }}</span>
      <button v-if="toast.actionLabel" class="toast-action-btn" type="button" @click="triggerToastAction">
        {{ toast.actionLabel }}
      </button>
    </div>
  </AppShell>
</template>
