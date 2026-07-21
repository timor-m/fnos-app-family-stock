<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  Bot,
  Boxes,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  ClipboardCheck,
  Clock3,
  Database,
  Download,
  Home,
  LayoutDashboard,
  LoaderCircle,
  MapPin,
  MapPinned,
  Pencil,
  PackageOpen,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRound,
  X
} from "@lucide/vue";
import InventoryTable from "./components/InventoryTable.vue";
import InventoryHistoryList from "./components/InventoryHistoryList.vue";
import PhotoIntakeModal from "./components/PhotoIntakeModal.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import QuantityInput from "./components/QuantityInput.vue";
import AiSettingsPanel from "./components/AiSettingsPanel.vue";
import {
  expiryClass,
  expiryLabel,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatQuantity
} from "./utils/format";
import { apiUrl } from "./utils/api";
import appIcon from "./assets/app-icon.png";

type ApiResponse<T> = {
  ok: boolean;
  data: T;
  statusMessage?: string;
  error?: {
    message?: string;
  };
};

type Location = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
};

type Family = {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  locations: Location[];
};

type FamilyMember = {
  userId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

type Category = {
  id: string;
  key: string;
  name: string;
  icon: string;
  fields: {
    enabled: string[];
    required: string[];
    defaultUnit: string;
    expirationEnabled: boolean;
  };
};

type InventoryItem = {
  batchId: string;
  productId: string;
  name: string;
  brand: string | null;
  specification: string | null;
  ingredients: string | null;
  coverImageId: string | null;
  coverImageUrl: string | null;
  categoryName: string;
  categoryKey: string;
  categoryId: string;
  quantity: number;
  unit: string;
  locationId: string;
  locationName: string;
  purchasedAt: string | null;
  productionDate: string | null;
  shelfLifeValue: number | null;
  shelfLifeUnit: string | null;
  expirationDate: string | null;
  unitPrice: number | null;
  channel: string | null;
  lowStockThreshold: number | null;
  daysRemaining: number | null;
  stockedByUserId: string | null;
  stockedByName: string | null;
  stockedAt: string | null;
  createdAt: string;
};

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

type LowStockItem = {
  productId: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  threshold: number;
};

type Dashboard = {
  summary: {
    productCount: number;
    totalQuantity: number;
    expiringCount: number;
    expiredCount: number;
    lowStockCount: number;
    pendingCount: number;
  };
  expiring: InventoryItem[];
  lowStock: LowStockItem[];
  recent: InventoryItem[];
  inventory: InventoryItem[];
  inventoryCount: number;
  inventoryOffset: number;
  inventoryLimit: number;
  inventoryHasMore: boolean;
};

type IntakeDraft = {
  id: string;
  categoryName: string | null;
  status: string;
  processingStage: string | null;
  userValues: Record<string, unknown>;
  imageCount: number;
  completedJobCount: number;
  failedJobCount: number;
  updatedAt: string;
};

type OcrStatus = {
  worker: {
    state: string;
    ready: boolean;
    running: boolean;
    engine: string | null;
    modelVersion: string | null;
    errorMessage: string | null;
  };
  queue: {
    queued: number;
    processing: number;
    failed: number;
  };
  installer?: {
    state: "idle" | "installing" | "succeeded" | "failed";
    running: boolean;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    errorMessage: string | null;
    logTail: string[];
    setupScript: string;
    venvDir: string;
  };
};

type SessionUser = {
  authenticated: boolean;
  uid: string | null;
  username: string | null;
  isAdmin: boolean;
};

type ViewKey = "overview" | "inventory" | "history" | "expiry" | "intakes" | "locations";
type ProfileSection = "family" | "locations" | "ai";
type ManageMode = "create-family" | "rename-family" | "create-location" | "rename-location";
type OperationType = "consume" | "discard" | "transfer" | "adjust";
type ToastType = "success" | "error" | "dark";

const loading = ref(true);
const refreshing = ref(false);
const pullRefreshing = ref(false);
const pullDistance = ref(0);
const submitting = ref(false);
const inventoryLoadingMore = ref(false);
const installingOcr = ref(false);
const serverOnline = ref(true);
const error = ref("");
const modalError = ref("");
const toast = ref<{ text: string; type: ToastType } | null>(null);
const families = ref<Family[]>([]);
const familyMembers = ref<Record<string, FamilyMember[]>>({});
const categories = ref<Category[]>([]);
const dashboard = ref<Dashboard | null>(null);
const inventoryHistory = ref<InventoryHistoryItem[]>([]);
const intakeDrafts = ref<IntakeDraft[]>([]);
const ocrStatus = ref<OcrStatus | null>(null);
const session = ref<SessionUser | null>(null);
const selectedFamilyId = ref("");
const selectedLocationId = ref("");
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
  reason: ""
});
const editForm = ref({
  name: "",
  brand: "",
  categoryId: "",
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
const confirmState = ref<{
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
} | null>(null);
const workspaceEl = ref<HTMLElement | null>(null);
const intakeNameInput = ref<HTMLInputElement | null>(null);
const manageNameInput = ref<HTMLInputElement | null>(null);
let intakePollTimer: number | null = null;
let toastTimer: number | null = null;
let intakeSnapshot = "";
let pullStartY = 0;
let pullTracking = false;
const pullThreshold = 52;
const inventoryPageSize = 20;
let searchTimer: number | null = null;

const today = new Date().toISOString().slice(0, 10);
const intakeForm = ref({
  name: "",
  brand: "",
  categoryId: "",
  locationId: "",
  quantity: 1,
  unit: "件",
  specification: "",
  purchasedAt: today,
  expirationDate: "",
  unitPrice: "",
  channel: "",
  lowStockThreshold: ""
});

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    ...init
  });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || payload.statusMessage || "请求失败");
  }

  return payload.data;
}

const currentFamily = computed(
  () => families.value.find((family) => family.id === selectedFamilyId.value) || families.value[0] || null
);

const currentLocationName = computed(() => {
  if (!selectedLocationId.value) {
    return "全部地点";
  }
  return currentFamily.value?.locations.find((location) => location.id === selectedLocationId.value)?.name || "全部地点";
});

const selectedCategory = computed(
  () => categories.value.find((category) => category.id === intakeForm.value.categoryId) || null
);
const selectedEditCategory = computed(
  () => categories.value.find((category) => category.id === editForm.value.categoryId) || null
);

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());

function matchesSearch(item: InventoryItem) {
  if (!normalizedSearch.value) {
    return true;
  }

  return [item.name, item.brand, item.specification, item.categoryName, item.locationName]
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

const canManageFamily = computed(() => {
  return session.value?.isAdmin || ["owner", "admin"].includes(currentFamily.value?.role || "");
});
const pullRefreshVisible = computed(() => pullDistance.value > 0 || pullRefreshing.value);
const pullRefreshReady = computed(() => pullDistance.value >= pullThreshold);
const pullRefreshLabel = computed(() => {
  if (pullRefreshing.value) return "正在刷新";
  return pullRefreshReady.value ? "松手刷新" : "下拉刷新";
});
const ocrReadySummary = computed(() => {
  const worker = ocrStatus.value?.worker;
  if (!worker) return "等待 OCR 状态";
  return `${worker.modelVersion || "PP-OCRv4 mobile"} · ${ocrQueueSummary.value}`;
});
const ocrQueueSummary = computed(() => {
  const queue = ocrStatus.value?.queue;
  if (!queue) return "进度：暂无任务";
  return `进度：${queue.processing} 处理中 / ${queue.queued} 排队 / ${queue.failed} 失败`;
});

const profileName = computed(() => session.value?.username || "本地用户");
const profileUid = computed(() => session.value?.uid || "local-owner");
const profileRoleLabel = computed(() => (canManageFamily.value ? "管理员" : "普通成员"));

const viewTitle = computed(() => {
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

const searchEnabled = computed(() => ["inventory", "history", "expiry"].includes(activeView.value));
const searchPlaceholder = computed(() => {
  if (activeView.value === "history") return "搜索历史物品、品牌或地点";
  if (activeView.value === "expiry") return "搜索临期商品、品牌或地点";
  return "搜索商品、品牌或地点";
});

const managementTitle = computed(() => {
  if (manageMode.value === "create-family") return "新增家庭";
  if (manageMode.value === "rename-family") return "重命名家庭";
  if (manageMode.value === "rename-location") return "重命名地点";
  return "新增地点";
});

const operationTitle = computed(() => {
  const labels: Record<OperationType, string> = {
    consume: "消耗库存",
    discard: "丢弃库存",
    transfer: "转移库存",
    adjust: "盘点调整"
  };
  return labels[operationType.value];
});

async function loadDashboard(showRefreshing = true, options: { appendInventory?: boolean } = {}) {
  if (!selectedFamilyId.value) {
    dashboard.value = null;
    return;
  }

  const appendInventory = options.appendInventory === true;
  const inventoryOffset = appendInventory ? dashboard.value?.inventory.length || 0 : 0;
  if (showRefreshing) {
    refreshing.value = true;
  }
  try {
    const params = new URLSearchParams({ familyId: selectedFamilyId.value });
    params.set("inventoryLimit", String(inventoryPageSize));
    params.set("inventoryOffset", String(inventoryOffset));
    if (normalizedSearch.value) {
      params.set("search", normalizedSearch.value);
    }
    if (selectedLocationId.value) {
      params.set("locationId", selectedLocationId.value);
    }
    const nextDashboard = await request<Dashboard>(`dashboard?${params.toString()}`);
    if (appendInventory && dashboard.value) {
      dashboard.value = {
        ...nextDashboard,
        inventory: [...dashboard.value.inventory, ...nextDashboard.inventory]
      };
    } else {
      dashboard.value = nextDashboard;
    }
  } finally {
    if (showRefreshing) {
      refreshing.value = false;
    }
  }
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
  if (!selectedFamilyId.value) {
    inventoryHistory.value = [];
    return;
  }

  const params = new URLSearchParams({ familyId: selectedFamilyId.value });
  if (selectedLocationId.value) {
    params.set("locationId", selectedLocationId.value);
  }
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
  session.value = await request<SessionUser>("session");
}

async function refreshProcessingState() {
  if (!selectedFamilyId.value) return;
  try {
    await Promise.all([loadIntakes(), loadOcrStatus()]);
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
    showToast(err instanceof Error ? err.message : "数据加载失败", "error");
  }
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

async function refreshCurrentView(options: { fromPull?: boolean } = {}) {
  if (loading.value || (pullRefreshing.value && !options.fromPull)) return;
  refreshing.value = true;
  error.value = "";
  try {
    const previousFamilyId = selectedFamilyId.value;
    const [categoryData] = await Promise.all([
      request<Category[]>("categories"),
      loadSession(),
      loadFamilies(previousFamilyId)
    ]);
    categories.value = categoryData;
    if (!intakeForm.value.categoryId && categoryData[0]) {
      intakeForm.value.categoryId = categoryData[0].id;
    }

    if (selectedFamilyId.value) {
      await Promise.all([
        loadDashboard(false),
        activeView.value === "history" ? loadInventoryHistory() : Promise.resolve(),
        loadIntakes(),
        loadOcrStatus(),
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
    showToast(err instanceof Error ? err.message : "刷新失败", "error");
  } finally {
    refreshing.value = false;
  }
}

async function loadFamilyMembers(familyId: string) {
  if (!familyId || !canManageFamily.value) {
    return;
  }
  familyMembers.value = {
    ...familyMembers.value,
    [familyId]: await request<FamilyMember[]>(`families/${familyId}/members`)
  };
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
  loading.value = true;
  error.value = "";

  try {
    const [familyData, categoryData] = await Promise.all([
      request<Family[]>("families"),
      request<Category[]>("categories"),
      loadSession()
    ]);
    families.value = familyData;
    categories.value = categoryData;
    selectedFamilyId.value = familyData[0]?.id || "";
    intakeForm.value.categoryId = categoryData[0]?.id || "";
    await Promise.all([loadDashboard(), loadIntakes(), loadOcrStatus()]);
    serverOnline.value = true;
  } catch (err) {
    serverOnline.value = false;
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function showToast(message: string, type: ToastType = "success") {
  toast.value = { text: message, type };
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = null;
  }, 2800);
}

function askConfirm(options: { title: string; message: string; confirmText?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    confirmState.value = { ...options, resolve };
  });
}

function resolveConfirm(value: boolean) {
  confirmState.value?.resolve(value);
  confirmState.value = null;
}

function setView(view: ViewKey) {
  activeView.value = view;
  if (!["inventory", "history", "expiry"].includes(view)) {
    searchQuery.value = "";
  }
  if (view === "history") {
    void guarded(loadInventoryHistory);
  } else if (view === "inventory") {
    void nextTick(() => onWindowScroll());
  }
}

function toggleProfileSection(section: ProfileSection) {
  const nextSection = expandedProfileSection.value === section ? null : section;
  expandedProfileSection.value = nextSection;
  if (nextSection === "family" && !expandedFamilyTreeId.value) {
    const firstFamilyId = families.value[0]?.id || "";
    if (firstFamilyId) {
      void toggleFamilyTree(firstFamilyId);
    }
  }
}

function openIntake() {
  const defaultLocation =
    currentFamily.value?.locations.find((location) => location.isDefault) || currentFamily.value?.locations[0];
  const defaultCategory = categories.value[0];
  intakeForm.value = {
    name: "",
    brand: "",
    categoryId: defaultCategory?.id || "",
    locationId: selectedLocationId.value || defaultLocation?.id || "",
    quantity: 1,
    unit: defaultCategory?.fields.defaultUnit || "件",
    specification: "",
    purchasedAt: today,
    expirationDate: "",
    unitPrice: "",
    channel: "",
    lowStockThreshold: ""
  };
  modalError.value = "";
  intakeOpen.value = true;
  // Snapshot after the category watcher settles so the dirty check starts clean.
  void nextTick(() => {
    intakeSnapshot = JSON.stringify(intakeForm.value);
  });
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

function intakeStatus(item: IntakeDraft) {
  const stage = item.processingStage || item.status;
  const states: Record<string, { label: string; tone: string }> = {
    draft: { label: "草稿", tone: "neutral" },
    queued: { label: "排队中", tone: "notice" },
    waiting_runtime: { label: "等待 OCR 环境", tone: "warning" },
    ocr_processing: { label: "OCR 识别中", tone: "notice" },
    rule_parsing: { label: "规则解析中", tone: "notice" },
    ai_queued: { label: "等待 AI 整理", tone: "notice" },
    ai_processing: { label: "AI 整理中", tone: "notice" },
    retry_wait: { label: "等待重试", tone: "warning" },
    needs_review: { label: "待确认", tone: "success" },
    failed: { label: "识别失败", tone: "danger" },
    completed: { label: "已入库", tone: "success" }
  };
  return states[stage] || { label: stage, tone: "neutral" };
}

function intakeName(item: IntakeDraft) {
  return typeof item.userValues.name === "string" && item.userValues.name
    ? item.userValues.name
    : `${item.categoryName || "商品"}拍照草稿`;
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

function openManagement(mode: ManageMode, target?: { id: string; name: string }) {
  manageMode.value = mode;
  manageTargetId.value = target?.id || "";
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
    } else {
      await request(`locations/${manageTargetId.value}`, {
        method: "PATCH",
        body: JSON.stringify({ name: manageName.value })
      });
      showToast("地点名称已更新");
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

function memberRoleLabel(role: FamilyMember["role"]) {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
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
    closeMemberDialog();
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
    }
    await loadFamilies(selectedFamilyId.value);
    await loadDashboard();
    showToast("地点已删除");
  } catch (err) {
    showToast(err instanceof Error ? err.message : "删除失败", "error");
  }
}

function locationInventoryCount(locationId: string) {
  return (dashboard.value?.inventory || []).filter((item) => item.locationId === locationId).length;
}

function selectOperation(type: OperationType) {
  operationType.value = type;
  operationForm.value.reason = "";
  operationForm.value.quantity = 1;
  operationForm.value.targetQuantity = operationItem.value?.quantity || 0;
  operationForm.value.toLocationId = "";
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
}

function openEditFromOperation() {
  if (!operationItem.value || submitting.value) return;
  const item = operationItem.value;
  operationOpen.value = false;
  openEditInventory(item);
}

function closeEditInventory() {
  if (!submitting.value) {
    editOpen.value = false;
    editItem.value = null;
  }
}

async function submitEditInventory() {
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

function trapTabKey(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const container = event.currentTarget as HTMLElement;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (confirmState.value) {
    resolveConfirm(false);
    return;
  }
  if (operationOpen.value) {
    closeOperation();
    return;
  }
  if (editOpen.value) {
    closeEditInventory();
    return;
  }
  if (messagesOpen.value) {
    messagesOpen.value = false;
    return;
  }
  if (memberOpen.value) {
    closeMemberDialog();
    return;
  }
  if (manageOpen.value) {
    closeManagement();
    return;
  }
  if (intakeOpen.value) {
    void attemptCloseIntake();
  }
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

function isInteractivePullTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    "button, input, select, textarea, a, .topbar, .mobile-nav, .modal-backdrop, [role='dialog']"
  ));
}

function isPageAtTop() {
  return window.scrollY <= 2 && document.documentElement.scrollTop <= 2 && document.body.scrollTop <= 2;
}

function onPullTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1 || loading.value || submitting.value || pullRefreshing.value) return;
  if (isInteractivePullTarget(event.target)) return;
  if (!isPageAtTop()) return;
  pullTracking = true;
  pullStartY = event.touches[0].clientY;
  pullDistance.value = 0;
}

function onPullTouchMove(event: TouchEvent) {
  if (!pullTracking || event.touches.length !== 1) return;
  const delta = event.touches[0].clientY - pullStartY;
  if (delta <= 0 || !isPageAtTop()) {
    pullDistance.value = 0;
    return;
  }
  event.preventDefault();
  pullDistance.value = Math.min(96, delta * 0.55);
}

function onPullTouchCancel() {
  pullTracking = false;
  if (!pullRefreshing.value) {
    pullDistance.value = 0;
  }
}

async function onPullTouchEnd() {
  if (!pullTracking) return;
  pullTracking = false;
  const shouldRefresh = pullDistance.value >= pullThreshold;
  if (!shouldRefresh) {
    pullDistance.value = 0;
    return;
  }

  pullRefreshing.value = true;
  pullDistance.value = 76;
  try {
    await refreshCurrentView({ fromPull: true });
  } finally {
    pullRefreshing.value = false;
    pullDistance.value = 0;
  }
}

watch(selectedFamilyId, () => {
  selectedLocationId.value = "";
  searchQuery.value = "";
  expandedProfileSection.value = null;
  familyMembers.value = {};
  if (!loading.value) {
    void guarded(async () => {
      await loadDashboard();
      if (activeView.value === "history") {
        await loadInventoryHistory();
      }
      await refreshProcessingState();
    });
  }
});

watch(selectedLocationId, () => {
  if (!loading.value) {
    void guarded(async () => {
      await loadDashboard();
      if (activeView.value === "history") {
        await loadInventoryHistory();
      }
    });
  }
});

watch(normalizedSearch, () => {
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
  () => intakeForm.value.categoryId,
  () => {
    if (selectedCategory.value) {
      intakeForm.value.unit = selectedCategory.value.fields.defaultUnit;
      if (!selectedCategory.value.fields.expirationEnabled) {
        intakeForm.value.expirationDate = "";
      }
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

watch(intakeOpen, async (open) => {
  if (open) {
    await nextTick();
    intakeNameInput.value?.focus();
  }
});

watch(manageOpen, async (open) => {
  if (open) {
    await nextTick();
    manageNameInput.value?.focus();
  }
});

onMounted(() => {
  void loadApp();
  intakePollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void refreshProcessingState();
  }, 8000);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("scroll", onWindowScroll, { passive: true });
  workspaceEl.value?.addEventListener("touchstart", onPullTouchStart, { passive: true });
  workspaceEl.value?.addEventListener("touchmove", onPullTouchMove, { passive: false });
  workspaceEl.value?.addEventListener("touchend", onPullTouchEnd);
  workspaceEl.value?.addEventListener("touchcancel", onPullTouchCancel);
});

onBeforeUnmount(() => {
  if (intakePollTimer) window.clearInterval(intakePollTimer);
  if (toastTimer) window.clearTimeout(toastTimer);
  if (searchTimer) window.clearTimeout(searchTimer);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("keydown", onGlobalKeydown);
  window.removeEventListener("scroll", onWindowScroll);
  workspaceEl.value?.removeEventListener("touchstart", onPullTouchStart);
  workspaceEl.value?.removeEventListener("touchmove", onPullTouchMove);
  workspaceEl.value?.removeEventListener("touchend", onPullTouchEnd);
  workspaceEl.value?.removeEventListener("touchcancel", onPullTouchCancel);
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><img :src="appIcon" alt="家藏 Logo" /></div>
        <div>
          <strong>家藏</strong>
          <span>家庭库存</span>
        </div>
      </div>

      <label class="family-field">
        <span>当前家庭</span>
        <div class="select-wrap">
          <select v-model="selectedFamilyId" aria-label="选择家庭">
            <option v-for="family in families" :key="family.id" :value="family.id">
              {{ family.name }}
            </option>
          </select>
          <ChevronDown :size="15" />
        </div>
      </label>

      <nav class="main-nav" aria-label="主要导航">
        <button :class="{ active: activeView === 'overview' }" type="button" @click="setView('overview')">
          <LayoutDashboard :size="19" />
          <span>概览</span>
        </button>
        <button :class="{ active: activeView === 'inventory' || activeView === 'history' }" type="button" @click="setView('inventory')">
          <Boxes :size="19" />
          <span>库存</span>
          <small>{{ dashboard?.inventoryCount || 0 }}</small>
        </button>
        <button :class="{ active: activeView === 'expiry' }" type="button" @click="setView('expiry')">
          <Clock3 :size="19" />
          <span>临期</span>
          <small v-if="dashboard?.summary.expiringCount">{{ dashboard.summary.expiringCount }}</small>
        </button>
        <button :class="{ active: activeView === 'locations' }" type="button" @click="setView('locations')">
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

    <main ref="workspaceEl" class="workspace">
      <header class="topbar" :class="{ 'search-disabled': !searchEnabled }">
        <div v-if="searchEnabled" class="search-box">
          <Search :size="18" />
          <input v-model="searchQuery" type="search" :placeholder="searchPlaceholder" />
          <button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchQuery = ''">
            <X :size="16" />
          </button>
        </div>

        <div class="topbar-actions">
          <label class="location-select">
            <MapPin :size="17" />
            <select v-model="selectedLocationId" :disabled="!currentFamily" aria-label="筛选地点">
              <option value="">全部地点</option>
              <option v-for="location in currentFamily?.locations || []" :key="location.id" :value="location.id">
                {{ location.name }}
              </option>
            </select>
            <ChevronDown :size="15" />
          </label>
          <button class="icon-button" type="button" aria-label="查看待处理录入" title="查看待处理录入" @click="setView('intakes')">
            <Bell :size="19" />
            <span v-if="dashboard?.summary.pendingCount" class="notification-dot"></span>
          </button>
          <button class="secondary-photo-button" type="button" :disabled="!currentFamily" @click="openIntake">
            <PackagePlus :size="18" />
            <span>文字录入</span>
          </button>
          <button class="primary-button" type="button" :disabled="!currentFamily" @click="openPhotoIntake()">
            <Camera :size="18" />
            <span>拍照录入</span>
          </button>
        </div>

      </header>

      <div class="pull-refresh-indicator" :class="{ visible: pullRefreshVisible, ready: pullRefreshReady || pullRefreshing }">
        <LoaderCircle v-if="pullRefreshing" class="spin" :size="15" />
        <RotateCcw v-else :size="15" />
        <span>{{ pullRefreshLabel }}</span>
      </div>

      <div
        class="content"
        :class="{ refreshing }"
        :style="{ transform: pullDistance ? `translateY(${Math.min(pullDistance, 76)}px)` : '' }"
      >
        <header class="page-heading">
          <div>
            <h1>{{ viewTitle }}</h1>
            <p>{{ viewDescription }}</p>
          </div>
          <div class="page-heading-actions">
            <button
              v-if="activeView === 'locations'"
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

        <p v-if="error && dashboard" class="inline-error">
          <TriangleAlert :size="16" />{{ error }}
        </p>

        <div v-if="loading" class="page-state">
          <LoaderCircle class="spin" :size="28" />
          <span>正在加载库存</span>
        </div>

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
          <template v-if="activeView === 'overview'">
            <section class="metrics" aria-label="库存统计">
              <article
                class="metric-card"
                role="button"
                tabindex="0"
                aria-label="查看全部库存"
                @click="setView('inventory')"
                @keydown.enter.prevent="setView('inventory')"
                @keydown.space.prevent="setView('inventory')"
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
                @click="setView('expiry')"
                @keydown.enter.prevent="setView('expiry')"
                @keydown.space.prevent="setView('expiry')"
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
                aria-label="查看低库存相关库存"
                @click="setView('inventory')"
                @keydown.enter.prevent="setView('inventory')"
                @keydown.space.prevent="setView('inventory')"
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
                @click="setView('intakes')"
                @keydown.enter.prevent="setView('intakes')"
                @keydown.space.prevent="setView('intakes')"
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
                  <button type="button" @click="setView('expiry')">查看全部</button>
                </header>

                <div v-if="dashboard.expiring.length" class="expiry-list">
                  <article v-for="item in dashboard.expiring.slice(0, 5)" :key="item.batchId">
                    <div class="item-symbol">{{ item.name.slice(0, 1) }}</div>
                    <div class="item-main">
                      <strong>{{ item.name }}</strong>
                      <span>{{ item.locationName }} · {{ formatQuantity(item.quantity) }}{{ item.unit }}</span>
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
                    <p>已达到设置的补货阈值</p>
                  </div>
                </header>

                <div v-if="dashboard.lowStock.length" class="stock-list">
                  <article v-for="item in dashboard.lowStock" :key="item.productId">
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
                <button type="button" @click="setView('inventory')">全部库存</button>
              </header>
              <InventoryTable
                :items="dashboard.recent.filter(matchesSearch)"
                :filtered="normalizedSearch.length > 0"
                show-actions
                @operate="openOperation"
              />
            </section>
          </template>

          <section v-else-if="activeView === 'inventory'" class="data-section table-section full-section">
            <header class="section-heading">
              <div>
                <h2>库存批次</h2>
                <p>
                  共 {{ dashboard.inventoryCount }} 个有效批次
                  <template v-if="dashboard.inventoryCount > inventoryVisibleCount">
                    · 已显示 {{ inventoryVisibleCount }} 个
                  </template>
                </p>
              </div>
              <button class="secondary-action" type="button" @click="openIntake">
                <PackagePlus :size="16" />
                文字录入
              </button>
            </header>
            <InventoryTable
              :items="filteredInventory"
              :filtered="normalizedSearch.length > 0"
              show-actions
              @operate="openOperation"
            />
            <div v-if="dashboard.inventoryCount" class="load-more-sentinel">
              <button
                v-if="inventoryHasMore"
                type="button"
                :disabled="inventoryLoadingMore"
                @click="loadMoreInventory"
              >
                <LoaderCircle v-if="inventoryLoadingMore" class="spin" :size="15" />
                <ChevronDown v-else :size="15" />
                {{ inventoryLoadingMore ? "正在加载更多" : "加载更多" }}
              </button>
              <span v-else>已经到底啦</span>
            </div>
          </section>

          <section v-else-if="activeView === 'history'" class="data-section history-section full-section">
            <header class="section-heading">
              <div>
                <h2>历史物品</h2>
                <p>共 {{ filteredHistory.length }} 个已离库批次</p>
              </div>
              <button class="secondary-action" type="button" :disabled="refreshing" @click="loadInventoryHistory">
                <RefreshCw :size="16" />
                刷新
              </button>
            </header>
            <InventoryHistoryList :items="filteredHistory" />
          </section>

          <section v-else-if="activeView === 'expiry'" class="data-section table-section full-section">
            <header class="section-heading">
              <div>
                <h2>临期与过期批次</h2>
                <p>未来 30 天内到期及已经过期的库存</p>
              </div>
            </header>
            <InventoryTable
              :items="filteredExpiring"
              :filtered="normalizedSearch.length > 0"
              show-actions
              show-expiry-first
              @operate="openOperation"
            />
          </section>

          <section v-else-if="activeView === 'intakes'" class="intake-task-view">
            <div
              v-if="ocrStatus && !ocrStatus.worker.ready"
              class="ocr-runtime-banner"
              :class="{ installing: ocrStatus.installer?.running || ocrStatus.installer?.state === 'installing' }"
            >
              <LoaderCircle v-if="ocrStatus.installer?.running || ocrStatus.installer?.state === 'installing'" class="spin" :size="20" />
              <TriangleAlert v-else :size="20" />
              <div>
                <strong>{{ ocrStatus.installer?.running || ocrStatus.installer?.state === 'installing' ? "OCR 运行环境安装中" : "OCR 运行环境尚未就绪" }}</strong>
                <span v-if="ocrStatus.installer?.running || ocrStatus.installer?.state === 'installing'">
                  正在安装 RapidOCR/OpenVINO，图片仍会安全保存，完成后会自动继续处理
                </span>
                <span v-else>图片仍会安全保存，管理员可一键安装 RapidOCR/OpenVINO 环境</span>
              </div>
              <div class="ocr-runtime-actions">
                <button
                  v-if="session?.isAdmin && !(ocrStatus.installer?.running || ocrStatus.installer?.state === 'installing')"
                  type="button"
                  :disabled="installingOcr"
                  @click="installOcrRuntime"
                >
                  <LoaderCircle v-if="installingOcr" class="spin" :size="14" />
                  <Download v-else :size="14" />
                  {{ ocrStatus.installer?.state === 'failed' ? "重新安装" : "安装环境" }}
                </button>
                <button type="button" :disabled="refreshing" @click="loadOcrStatus">
                  <RefreshCw :size="14" />
                  刷新状态
                </button>
              </div>
              <code v-if="!ocrStatus.worker.errorMessage && !ocrStatus.installer?.logTail.length">等待运行环境检查</code>
              <details v-else class="ocr-error-detail">
                <summary>技术详情</summary>
                <code>{{ ocrStatus.installer?.errorMessage || ocrStatus.worker.errorMessage }}</code>
                <code v-if="ocrStatus.installer?.logTail.length">
                  {{ ocrStatus.installer.logTail.slice(-8).join("\n") }}
                </code>
              </details>
            </div>
            <div v-else-if="ocrStatus" class="ocr-runtime-banner ready">
              <CheckCircle2 :size="20" />
              <div>
                <strong>{{ ocrStatus.worker.engine || "RapidOCR" }} 已就绪</strong>
                <span>{{ ocrReadySummary }}</span>
              </div>
            </div>

            <section class="data-section intake-task-section">
              <header class="section-heading">
                <div>
                  <h2>录入草稿</h2>
                  <p>上传成功后可以关闭页面，后台任务不会丢失</p>
                </div>
                <button class="secondary-action" type="button" @click="openPhotoIntake()">
                  <Camera :size="16" />新建拍照录入
                </button>
              </header>

              <div v-if="intakeDrafts.length" class="intake-task-list">
                <button
                  v-for="item in intakeDrafts"
                  :key="item.id"
                  type="button"
                  @click="openPhotoIntake(item.id)"
                >
                  <div class="task-image-count"><Camera :size="19" /><span>{{ item.imageCount }}</span></div>
                  <div class="task-main">
                    <strong>{{ intakeName(item) }}</strong>
                    <span>
                      {{ item.categoryName || "未分类" }} ·
                      {{ item.completedJobCount }}/{{ item.imageCount }} 张已处理 ·
                      {{ formatDateTime(item.updatedAt) }}
                    </span>
                  </div>
                  <span :class="['status-chip', intakeStatus(item).tone]">{{ intakeStatus(item).label }}</span>
                  <ChevronDown class="task-arrow" :size="17" />
                </button>
              </div>
              <div v-else class="empty-state">
                <Camera :size="30" />
                <strong>还没有拍照录入任务</strong>
                <span>拍摄包装、标签和日期后，识别会在后台运行</span>
              </div>
            </section>
          </section>

          <div v-else class="profile-page">
            <section class="data-section profile-card">
              <div class="profile-avatar">{{ profileName.slice(0, 1) }}</div>
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
                  @click="toggleProfileSection('family')"
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
                  <button
                    class="secondary-action"
                    type="button"
                    @click="openManagement('create-family')"
                  >
                    <Plus :size="16" />
                    新增家庭
                  </button>
                </header>

                <div class="family-tree">
                  <article v-for="family in families" :key="family.id" class="family-tree-node">
                    <button class="family-tree-row" type="button" @click="toggleFamilyTree(family.id)">
                      <ChevronDown :class="{ expanded: expandedFamilyTreeId === family.id }" :size="16" />
                      <div class="family-avatar"><Home :size="20" /></div>
                      <div class="family-summary-main">
                        <strong>{{ family.name }}</strong>
                        <span>{{ family.memberCount }} 位成员 · {{ family.locations.length }} 个地点</span>
                      </div>
                      <span class="role-chip">{{ family.role === "owner" ? "所有者" : family.role === "admin" ? "管理员" : "成员" }}</span>
                      <span v-if="family.id === selectedFamilyId" class="default-chip">当前</span>
                    </button>

                    <div v-if="expandedFamilyTreeId === family.id" class="family-tree-children">
                      <div class="family-tree-toolbar">
                        <button
                          class="secondary-action"
                          type="button"
                          @click="openManagement('rename-family', { id: family.id, name: family.name })"
                        >
                          <Pencil :size="16" />
                          重命名分组
                        </button>
                        <button
                          class="secondary-action"
                          type="button"
                          @click="openMemberDialog(family)"
                        >
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
                              @click="removeMemberFromFamily(member)"
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
                  @click="toggleProfileSection('locations')"
                >
                  <MapPinned :size="19" />
                  <div>
                    <strong>房屋地点</strong>
                    <span>{{ currentFamily?.locations.length || 0 }} 个地点，配置库存存放位置</span>
                  </div>
                  <ChevronDown :size="16" />
                </button>

                <section v-if="expandedProfileSection === 'locations'" id="profile-locations" class="profile-panel location-panel">
                <header class="section-heading">
                  <div>
                    <h2>房屋地点</h2>
                    <p>库存批次按地点独立存放</p>
                  </div>
                  <button
                    class="secondary-action"
                    type="button"
                    @click="openManagement('create-location')"
                  >
                    <MapPin :size="16" />
                    新增地点
                  </button>
                </header>

                <div class="location-list">
                  <article v-for="location in currentFamily?.locations || []" :key="location.id">
                    <div class="location-icon"><Home v-if="location.kind === 'home'" :size="20" /><MapPin v-else :size="20" /></div>
                    <div class="location-main">
                      <div>
                        <strong>{{ location.name }}</strong>
                        <span v-if="location.isDefault" class="default-chip">默认</span>
                      </div>
                      <span>{{ locationInventoryCount(location.id) }} 个有效库存批次</span>
                    </div>
                    <div class="location-actions">
                      <button
                        class="icon-button subtle"
                        type="button"
                        :aria-label="`重命名 ${location.name}`"
                        :title="`重命名 ${location.name}`"
                        @click="openManagement('rename-location', location)"
                      >
                        <Pencil :size="16" />
                      </button>
                      <button
                        class="icon-button subtle danger-button"
                        type="button"
                        :aria-label="`删除 ${location.name}`"
                        :title="`删除 ${location.name}`"
                        @click="removeLocation(location)"
                      >
                        <Trash2 :size="16" />
                      </button>
                    </div>
                  </article>
                </div>
              </section>
              </article>

              <article v-if="canManageFamily" class="data-section profile-accordion-item">
                <button
                  class="profile-entry"
                  :class="{ expanded: expandedProfileSection === 'ai' }"
                  type="button"
                  :aria-expanded="expandedProfileSection === 'ai'"
                  aria-controls="profile-ai-settings"
                  @click="toggleProfileSection('ai')"
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
      </div>
    </main>

    <nav class="mobile-nav" aria-label="移动端导航">
      <button :class="{ active: activeView === 'overview' }" type="button" @click="setView('overview')">
        <LayoutDashboard :size="20" />
        <span>概览</span>
      </button>
      <button :class="{ active: activeView === 'inventory' || activeView === 'history' }" type="button" @click="setView('inventory')">
        <Boxes :size="20" />
        <span>库存</span>
      </button>
      <button class="mobile-add" type="button" :disabled="!currentFamily" aria-label="拍照录入" @click="openPhotoIntake()">
        <Camera :size="27" />
      </button>
      <button :class="{ active: activeView === 'expiry' }" type="button" @click="setView('expiry')">
        <Clock3 :size="20" />
        <span>临期</span>
      </button>
      <button :class="{ active: activeView === 'locations' }" type="button" @click="setView('locations')">
        <UserRound :size="20" />
        <span>我的</span>
      </button>
    </nav>

    <PhotoIntakeModal
      :open="photoIntakeOpen"
      :family="currentFamily"
      :categories="categories"
      :selected-location-id="selectedLocationId"
      :intake-id="photoIntakeId"
      @close="closePhotoIntake"
      @updated="refreshProcessingState"
      @completed="handlePhotoCompleted"
    />

    <div v-if="intakeOpen" class="modal-backdrop" @click.self="attemptCloseIntake">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="intake-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="intake-title">文字录入</h2>
            <p>不拍照，直接填写商品与库存信息</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="attemptCloseIntake">
            <X :size="20" />
          </button>
        </header>

        <form class="intake-form" @submit.prevent="submitIntake">
          <div class="intake-mode-switch" role="tablist" aria-label="录入方式">
            <button class="active" type="button" role="tab" aria-selected="true">
              <Pencil :size="16" />
              文字录入
            </button>
            <button type="button" role="tab" aria-selected="false" @click="switchToPhotoIntake">
              <Camera :size="16" />
              拍照录入
            </button>
          </div>

          <div class="form-grid">
            <label class="field span-2">
              <span>商品名称 <em>*</em></span>
              <input ref="intakeNameInput" v-model.trim="intakeForm.name" required maxlength="80" placeholder="例如：纯牛奶" />
            </label>

            <label class="field">
              <span>品牌</span>
              <input v-model.trim="intakeForm.brand" maxlength="50" placeholder="选填" />
            </label>

            <label class="field">
              <span>品类 <em>*</em></span>
              <select v-model="intakeForm.categoryId" required>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>规格</span>
              <input v-model.trim="intakeForm.specification" maxlength="40" placeholder="例如：250ml" />
            </label>

            <label class="field">
              <span>存放地点 <em>*</em></span>
              <select v-model="intakeForm.locationId" required>
                <option v-for="location in currentFamily?.locations || []" :key="location.id" :value="location.id">
                  {{ location.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>数量 <em>*</em></span>
              <QuantityInput v-model="intakeForm.quantity" required :min="0.01" />
            </label>

            <label class="field">
              <span>单位 <em>*</em></span>
              <input v-model.trim="intakeForm.unit" required maxlength="12" />
            </label>

            <label class="field">
              <span>购买日期</span>
              <input v-model="intakeForm.purchasedAt" type="date" />
            </label>

            <label v-if="selectedCategory?.fields.expirationEnabled" class="field">
              <span>到期日期</span>
              <input v-model="intakeForm.expirationDate" type="date" />
            </label>

            <label class="field">
              <span>单价</span>
              <div class="input-prefix">
                <span>¥</span>
                <input v-model="intakeForm.unitPrice" min="0" step="0.01" type="number" placeholder="0.00" />
              </div>
            </label>

            <label class="field">
              <span>购买渠道</span>
              <input v-model.trim="intakeForm.channel" maxlength="50" placeholder="例如：线下超市" />
            </label>

            <label class="field">
              <span>低库存阈值</span>
              <input v-model="intakeForm.lowStockThreshold" min="0" step="0.01" type="number" placeholder="选填" />
            </label>
          </div>

          <p v-if="modalError" class="form-error"><TriangleAlert :size="16" />{{ modalError }}</p>

          <footer class="modal-footer">
            <button class="cancel-button" type="button" @click="attemptCloseIntake">取消</button>
            <button class="primary-button" type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="spin" :size="18" />
              <PackagePlus v-else :size="18" />
              {{ submitting ? "正在保存" : "确认入库" }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div v-if="manageOpen" class="modal-backdrop" @click.self="closeManagement">
      <section class="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="manage-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="manage-title">{{ managementTitle }}</h2>
            <p>{{ manageMode.includes("family") ? "家庭用于隔离成员和库存数据" : `归属于${currentFamily?.name || "当前家庭"}` }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closeManagement">
            <X :size="20" />
          </button>
        </header>

        <form class="intake-form" @submit.prevent="submitManagement">
          <div class="form-grid">
            <label class="field span-2">
              <span>{{ manageMode.includes("family") ? "家庭名称" : "地点名称" }} <em>*</em></span>
              <input
                ref="manageNameInput"
                v-model.trim="manageName"
                required
                maxlength="50"
                :placeholder="manageMode.includes('family') ? '例如：上海的家' : '例如：广西老家'"
              />
            </label>
            <label v-if="manageMode === 'create-location'" class="field span-2">
              <span>地点类型</span>
              <select v-model="manageKind">
                <option value="home">住宅</option>
                <option value="storage">仓储</option>
                <option value="other">其他</option>
              </select>
            </label>
          </div>

          <p v-if="modalError" class="form-error"><TriangleAlert :size="16" />{{ modalError }}</p>

          <footer class="modal-footer">
            <button class="cancel-button" type="button" @click="closeManagement">取消</button>
            <button class="primary-button" type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="spin" :size="18" />
              <CheckCircle2 v-else :size="18" />
              {{ submitting ? "正在保存" : "保存" }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div v-if="memberOpen && memberTargetFamily" class="modal-backdrop" @click.self="closeMemberDialog">
      <section class="modal compact-modal" role="dialog" aria-modal="true" aria-labelledby="member-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="member-title">添加成员</h2>
            <p>加入到“{{ memberTargetFamily.name }}”家庭分组</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closeMemberDialog">
            <X :size="20" />
          </button>
        </header>

        <form class="intake-form" @submit.prevent="addMemberToFamily">
          <div class="form-grid">
            <label class="field span-2">
              <span>用户 ID <em>*</em></span>
              <input v-model.trim="memberForm.userId" required maxlength="80" placeholder="例如：fnos-user-id" />
            </label>
            <label class="field span-2">
              <span>成员昵称</span>
              <input v-model.trim="memberForm.displayName" maxlength="50" placeholder="不填则使用用户 ID" />
            </label>
            <label class="field span-2">
              <span>角色</span>
              <select v-model="memberForm.role">
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
          </div>

          <p v-if="modalError" class="form-error"><TriangleAlert :size="16" />{{ modalError }}</p>

          <footer class="modal-footer">
            <button class="cancel-button" type="button" @click="closeMemberDialog">取消</button>
            <button class="primary-button" type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="spin" :size="18" />
              <Plus v-else :size="18" />
              {{ submitting ? "正在添加" : "加入分组" }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div v-if="operationOpen && operationItem" class="modal-backdrop" @click.self="closeOperation">
      <section class="modal operation-modal" role="dialog" aria-modal="true" aria-labelledby="operation-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="operation-title">{{ operationTitle }}</h2>
            <p>{{ operationItem.name }} · 当前 {{ formatQuantity(operationItem.quantity) }}{{ operationItem.unit }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closeOperation">
            <X :size="20" />
          </button>
        </header>

        <form class="intake-form" @submit.prevent="submitOperation">
          <div class="operation-segments" role="tablist" aria-label="库存操作">
            <button
              :class="{ active: operationType === 'consume' }"
              type="button"
              role="tab"
              @click="selectOperation('consume')"
            >
              <CircleMinus :size="17" />消耗
            </button>
            <button
              :class="{ active: operationType === 'discard' }"
              type="button"
              role="tab"
              @click="selectOperation('discard')"
            >
              <Trash2 :size="17" />丢弃
            </button>
            <button
              :class="{ active: operationType === 'transfer' }"
              type="button"
              role="tab"
              @click="selectOperation('transfer')"
            >
              <ArrowRightLeft :size="17" />转移
            </button>
            <button
              :class="{ active: operationType === 'adjust' }"
              type="button"
              role="tab"
              @click="selectOperation('adjust')"
            >
              <ClipboardCheck :size="17" />盘点
            </button>
          </div>

          <div class="operation-summary">
            <div class="item-symbol">
              <img v-if="operationItem.coverImageUrl" :src="operationItem.coverImageUrl" :alt="operationItem.name" loading="lazy" />
              <template v-else>{{ operationItem.name.slice(0, 1) }}</template>
            </div>
            <div>
              <strong>{{ operationItem.name }}</strong>
              <span>{{ operationItem.locationName }} · {{ operationItem.categoryName }}</span>
            </div>
            <strong>{{ formatQuantity(operationItem.quantity) }} {{ operationItem.unit }}</strong>
            <button class="edit-info-button" type="button" @click="openEditFromOperation">
              <Pencil :size="15" />
              编辑信息
            </button>
          </div>

          <div class="form-grid operation-fields">
            <label v-if="operationType !== 'adjust'" class="field">
              <span>操作数量 <em>*</em></span>
              <QuantityInput v-model="operationForm.quantity" required :min="0.01" :max="operationItem.quantity" />
            </label>

            <label v-else class="field span-2">
              <span>盘点后数量 <em>*</em></span>
              <QuantityInput v-model="operationForm.targetQuantity" required :min="0" />
            </label>

            <label v-if="operationType === 'transfer'" class="field">
              <span>目标地点 <em>*</em></span>
              <select v-model="operationForm.toLocationId" required>
                <option value="" disabled>请选择</option>
                <option v-for="location in availableTransferLocations" :key="location.id" :value="location.id">
                  {{ location.name }}
                </option>
              </select>
            </label>

            <label class="field span-2">
              <span>
                原因或备注
                <em v-if="operationType === 'discard' || operationType === 'adjust'">*</em>
              </span>
              <textarea
                v-model.trim="operationForm.reason"
                :required="operationType === 'discard' || operationType === 'adjust'"
                maxlength="200"
                rows="3"
                :placeholder="operationType === 'consume' ? '选填' : '记录本次操作原因'"
              ></textarea>
            </label>
          </div>

          <p v-if="operationType === 'transfer' && !availableTransferLocations.length" class="form-warning">
            <MapPin :size="16" />请先在“我的”中新增另一个房屋地点
          </p>
          <p v-if="modalError" class="form-error"><TriangleAlert :size="16" />{{ modalError }}</p>

          <footer class="modal-footer">
            <button class="cancel-button" type="button" @click="closeOperation">取消</button>
            <button
              class="primary-button"
              type="submit"
              :disabled="submitting || (operationType === 'transfer' && (!availableTransferLocations.length || !operationForm.toLocationId))"
            >
              <LoaderCircle v-if="submitting" class="spin" :size="18" />
              <RotateCcw v-else-if="operationType === 'adjust'" :size="18" />
              <ArrowRightLeft v-else-if="operationType === 'transfer'" :size="18" />
              <CircleMinus v-else :size="18" />
              {{ submitting ? "正在处理" : operationTitle }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <div v-if="editOpen && editItem" class="modal-backdrop" @click.self="closeEditInventory">
      <section class="modal inventory-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-inventory-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="edit-inventory-title">编辑库存信息</h2>
            <p>修改已入库物品的结构化信息，不会新建入库记录</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closeEditInventory">
            <X :size="20" />
          </button>
        </header>

        <form class="inventory-edit-form" @submit.prevent="submitEditInventory">
          <div class="inventory-edit-source">
            <div class="inventory-edit-cover">
              <img v-if="editItem.coverImageUrl" :src="editItem.coverImageUrl" :alt="editItem.name" loading="lazy" />
              <span v-else>{{ editItem.name.slice(0, 1) }}</span>
            </div>
            <div>
              <strong>{{ editItem.coverImageUrl ? "拍照识别入库信息" : "库存信息" }}</strong>
              <span>
                {{ editItem.locationName }} · 当前 {{ formatQuantity(editItem.quantity) }}{{ editItem.unit }}
                <template v-if="editItem.stockedByName || editItem.stockedByUserId">
                  · 入库人 {{ editItem.stockedByName || editItem.stockedByUserId }}
                </template>
              </span>
            </div>
          </div>

          <div class="form-grid">
            <label class="field span-2">
              <span>商品名称 <em>*</em></span>
              <input v-model.trim="editForm.name" required maxlength="80" placeholder="例如：东方树叶茉莉花茶" />
            </label>

            <label class="field">
              <span>品牌</span>
              <input v-model.trim="editForm.brand" maxlength="50" placeholder="选填" />
            </label>

            <label class="field">
              <span>品类 <em>*</em></span>
              <select v-model="editForm.categoryId" required>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>规格</span>
              <input v-model.trim="editForm.specification" maxlength="80" placeholder="例如：335ml" />
            </label>

            <label class="field">
              <span>单位 <em>*</em></span>
              <input v-model.trim="editForm.unit" required maxlength="12" />
            </label>

            <label class="field">
              <span>购买日期</span>
              <input v-model="editForm.purchasedAt" type="date" />
            </label>

            <template v-if="selectedEditCategory?.fields.expirationEnabled">
              <label class="field">
                <span>生产日期</span>
                <input v-model="editForm.productionDate" type="date" />
              </label>

              <label class="field">
                <span>保质期</span>
                <div class="shelf-life-inline">
                  <input v-model="editForm.shelfLifeValue" min="1" step="1" type="number" placeholder="数值" />
                  <select v-model="editForm.shelfLifeUnit">
                    <option value="day">天</option>
                    <option value="month">月</option>
                    <option value="year">年</option>
                  </select>
                </div>
              </label>

              <label class="field">
                <span>到期日期</span>
                <input v-model="editForm.expirationDate" type="date" />
              </label>
            </template>

            <label class="field">
              <span>单价</span>
              <div class="input-prefix">
                <span>¥</span>
                <input v-model="editForm.unitPrice" min="0" step="0.01" type="number" placeholder="0.00" />
              </div>
            </label>

            <label class="field">
              <span>购买渠道</span>
              <input v-model.trim="editForm.channel" maxlength="50" placeholder="例如：线下超市" />
            </label>

            <label class="field">
              <span>低库存阈值</span>
              <input v-model="editForm.lowStockThreshold" min="0" step="0.01" type="number" placeholder="选填" />
            </label>

            <label class="field span-2">
              <span>配料表 / 标签信息</span>
              <textarea v-model.trim="editForm.ingredients" maxlength="2000" rows="4" placeholder="可粘贴或修正 OCR/AI 提取出的配料表内容"></textarea>
            </label>
          </div>

          <p class="form-hint">数量变化请使用“消耗 / 盘点 / 转移”，这里仅编辑商品与批次信息。</p>
          <p v-if="modalError" class="form-error"><TriangleAlert :size="16" />{{ modalError }}</p>

          <footer class="modal-footer">
            <button class="cancel-button" type="button" @click="closeEditInventory">取消</button>
            <button class="primary-button" type="submit" :disabled="submitting">
              <LoaderCircle v-if="submitting" class="spin" :size="18" />
              <CheckCircle2 v-else :size="18" />
              {{ submitting ? "正在保存" : "保存修改" }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <ConfirmDialog
      :open="!!confirmState"
      :title="confirmState?.title || ''"
      :message="confirmState?.message || ''"
      :confirm-text="confirmState?.confirmText"
      :danger="confirmState?.danger"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />

    <div v-if="messagesOpen" class="modal-backdrop" @click.self="messagesOpen = false">
      <section class="modal compact-modal message-modal" role="dialog" aria-modal="true" aria-labelledby="messages-title" @keydown="trapTabKey">
        <header class="modal-header">
          <div>
            <h2 id="messages-title">消息</h2>
            <p>{{ intakeDrafts.length ? `${intakeDrafts.length} 条拍照录入待处理` : "暂无待处理消息" }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="messagesOpen = false">
            <X :size="20" />
          </button>
        </header>

        <div v-if="intakeDrafts.length" class="message-list">
          <button
            v-for="item in intakeDrafts"
            :key="item.id"
            type="button"
            @click="openMessageIntake(item.id)"
          >
            <div class="task-image-count"><Camera :size="18" /><span>{{ item.imageCount }}</span></div>
            <div class="task-main">
              <strong>{{ intakeName(item) }}</strong>
              <span>
                {{ item.categoryName || "未分类" }} ·
                {{ item.completedJobCount }}/{{ item.imageCount }} 张已处理 ·
                {{ formatDateTime(item.updatedAt) }}
              </span>
            </div>
            <span :class="['status-chip', intakeStatus(item).tone]">{{ intakeStatus(item).label }}</span>
          </button>
        </div>
        <div v-else class="empty-state compact">
          <CheckCircle2 :size="28" />
          <strong>暂无消息</strong>
          <span>需要确认的拍照录入会显示在这里</span>
        </div>
      </section>
    </div>

    <div v-if="toast" class="toast" :class="toast.type" role="status">
      <TriangleAlert v-if="toast.type === 'error'" :size="18" />
      <CheckCircle2 v-else :size="18" />
      {{ toast.text }}
    </div>
  </div>
</template>
