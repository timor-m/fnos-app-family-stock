export type StoragePlace = {
  id: string;
  name: string;
};

export type Location = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  storagePlaces: StoragePlace[];
};

export type Family = {
  id: string;
  name: string;
  role: string;
  memberCount: number;
  locations: Location[];
};

export type FamilyMember = {
  userId: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

export type Category = {
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

export type InventoryItem = {
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
  storagePlaceId: string | null;
  storagePlaceName: string | null;
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

export type InventoryHistoryItem = {
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

export type LowStockItem = {
  productId: string;
  categoryId?: string;
  name: string;
  brand: string | null;
  specification?: string | null;
  quantity: number;
  unit: string;
  threshold: number;
};

export type Dashboard = {
  summary: {
    productCount: number;
    activeBatchCount: number;
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
  locationBatchCounts: Record<string, number>;
};

export type IntakeDraft = {
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

export type OcrStatus = {
  worker: {
    state: string;
    ready: boolean;
    running: boolean;
    checkedAt?: string | null;
    engine: string | null;
    modelVersion: string | null;
    rapidocrVersion?: string | null;
    openvinoVersion?: string | null;
    pythonVersion?: string | null;
    errorCode?: string | null;
    errorMessage: string | null;
    pythonBin?: string;
    workerScript?: string;
  };
  queue: {
    queued: number;
    processing: number;
    failed: number;
    runnerStarted?: boolean;
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

export type SessionUser = {
  authenticated: boolean;
  uid: string | null;
  username: string | null;
  isAdmin: boolean;
};

export type AiStatus = {
  settings: {
    enabled: boolean;
    provider: string;
    model: string;
    apiKeyConfigured: boolean;
  };
  queue: {
    queued: number;
    processing: number;
    failed: number;
    runnerStarted: boolean;
  };
};

export type SystemStatus = {
  appName: string;
  appTitle: string;
  accessMode: "gateway" | "port";
  gatewayPrefix: string;
  appPort: number | null;
  runtime: string;
  nodeVersion: string;
  nodePlatform: string;
  nodeArch: string;
  processUptimeSec: number;
  database: {
    path: string;
    exists: boolean;
    initialized: boolean;
    schemaVersion: number;
  };
  ai: {
    enabled: boolean;
    provider: string;
    configured: boolean;
    model: string;
  };
};
