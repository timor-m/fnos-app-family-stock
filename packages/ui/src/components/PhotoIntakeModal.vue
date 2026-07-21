<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  FileSearch,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  UploadCloud,
  X
} from "@lucide/vue";
import QuantityInput from "./QuantityInput.vue";
import { apiUrl } from "../utils/api";

type Location = { id: string; name: string; isDefault: boolean };
type Family = { id: string; name: string; locations: Location[] };
type Category = {
  id: string;
  name: string;
  fields: { enabled: string[]; defaultUnit: string; expirationEnabled: boolean };
};
type Candidate = {
  id: string;
  basedOnVersion?: number;
  fieldKey: string;
  value: unknown;
  source: string;
  confidence: number | null;
  evidence: {
    imageId?: string;
    lineIds?: string[];
    sourceText?: string;
    ocrConfidence?: number;
  };
};
type Media = {
  id: string;
  imageRole: ImageRole;
  mimeType: string;
};
type Job = {
  id: string;
  imageId: string;
  jobType?: string;
  status: string;
  stage: string | null;
  attempts: number;
  errorMessage: string | null;
};
type OcrResult = {
  id: string;
  imageId: string;
  engine: string;
  modelVersion: string;
  lines: Array<{
    id?: string;
    text?: string;
    confidence?: number;
  }>;
};
type IntakeDetail = {
  id: string;
  version: number;
  status: string;
  processingStage: string | null;
  locationId: string | null;
  categoryId: string | null;
  userValues: Record<string, unknown>;
  media: Media[];
  jobs: Job[];
  ocrResults: OcrResult[];
  candidates: Candidate[];
};
type ImageRole = "product" | "label" | "date";
type UploadState = {
  file: File | null;
  preview: string;
  progress: number;
  state: "idle" | "uploading" | "uploaded" | "failed";
  error: string;
};
type ApiResponse<T> = {
  ok: boolean;
  data: T;
  statusMessage?: string;
  error?: { message?: string };
};

const props = defineProps<{
  open: boolean;
  family: Family | null;
  categories: Category[];
  selectedLocationId: string;
  intakeId?: string;
}>();
const emit = defineEmits<{
  close: [];
  updated: [];
  completed: [];
}>();

const today = new Date().toISOString().slice(0, 10);
const loading = ref(false);
const submitting = ref(false);
const savingDraft = ref(false);
const reextractingAi = ref(false);
const rerunningOcr = ref(false);
const error = ref("");
const draftId = ref("");
const detail = ref<IntakeDetail | null>(null);
const acceptedCandidateIds = ref(new Set<string>());
const seenCandidateIds = ref(new Set<string>());
const preApplyValues = ref(new Map<string, unknown>());
const hydratedDraftId = ref("");
const recognitionOpen = ref(false);
const fileInputs: Partial<Record<ImageRole, HTMLInputElement>> = {};
let pollTimer: number | null = null;
let saveTimer: number | null = null;
let savePromise: Promise<void> | null = null;
let savePending = false;

const form = ref({
  name: "",
  brand: "",
  categoryId: "",
  locationId: "",
  quantity: 1,
  unit: "件",
  specification: "",
  ingredients: "",
  purchasedAt: today,
  productionDate: "",
  shelfLifeValue: "",
  shelfLifeUnit: "month",
  expirationDate: "",
  unitPrice: "",
  channel: "",
  lowStockThreshold: ""
});

const roles: Array<{ key: ImageRole; step: string; title: string; description: string }> = [
  { key: "product", step: "1", title: "商品主体", description: "拍摄正面包装，识别商品名、品牌和规格" },
  { key: "label", step: "2", title: "配料与标签", description: "拍摄配料表、净含量和保质期区域" },
  { key: "date", step: "3", title: "生产日期", description: "靠近喷码拍摄生产或到期日期" }
];

const uploads = ref<Record<ImageRole, UploadState>>({
  product: { file: null, preview: "", progress: 0, state: "idle", error: "" },
  label: { file: null, preview: "", progress: 0, state: "idle", error: "" },
  date: { file: null, preview: "", progress: 0, state: "idle", error: "" }
});

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers
    }
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message || payload.statusMessage || "请求失败");
  }
  return payload.data;
}

const selectedCategory = computed(
  () => props.categories.find((category) => category.id === form.value.categoryId) || null
);
const hasUploading = computed(() =>
  Object.values(uploads.value).some((item) => item.state === "uploading")
);
const canReview = computed(() =>
  detail.value && ["needs_review", "failed"].includes(detail.value.status)
);
const statusInfo = computed(() => {
  const stage = detail.value?.processingStage || "draft";
  const map: Record<string, { label: string; tone: string }> = {
    draft: { label: "等待上传", tone: "neutral" },
    queued: { label: "已保存，排队中", tone: "notice" },
    waiting_runtime: { label: "等待 OCR 环境", tone: "warning" },
    ocr_processing: { label: "OCR 识别中", tone: "notice" },
    rule_parsing: { label: "规则解析中", tone: "notice" },
    ai_queued: { label: "等待 AI 整理", tone: "notice" },
    ai_processing: { label: "AI 正在整理字段", tone: "notice" },
    retry_wait: { label: "等待自动重试", tone: "warning" },
    needs_review: { label: "待确认", tone: "success" },
    failed: { label: "部分识别失败", tone: "danger" },
    completed: { label: "已完成入库", tone: "success" }
  };
  return map[stage] || map[detail.value?.status || "draft"] || { label: stage, tone: "neutral" };
});
const recognizedLineCount = computed(() =>
  detail.value?.ocrResults.reduce((total, result) => total + result.lines.length, 0) || 0
);
const recognizedCandidateCount = computed(() => detail.value?.candidates.length || 0);
const canReextractAi = computed(() =>
  Boolean(
    draftId.value &&
    recognizedLineCount.value > 0 &&
    detail.value &&
    !["completed", "cancelled", "ocr_processing", "ai_queued", "ai_processing"].includes(detail.value.processingStage || detail.value.status)
  )
);
const hasActiveOcrJob = computed(() =>
  Boolean(detail.value?.jobs.some((job) => job.jobType === "ocr" && ["queued", "processing"].includes(job.status)))
);
const hasActiveAiJob = computed(() =>
  Boolean(detail.value?.jobs.some((job) => job.jobType === "ai" && ["queued", "processing"].includes(job.status)))
);
const canRerunOcr = computed(() =>
  Boolean(
    draftId.value &&
    detail.value?.media.length &&
    detail.value &&
    !["completed", "cancelled"].includes(detail.value.status) &&
    !hasActiveOcrJob.value &&
    !hasActiveAiJob.value
  )
);

function reset() {
  for (const item of Object.values(uploads.value)) {
    if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  }
  error.value = "";
  draftId.value = "";
  detail.value = null;
  hydratedDraftId.value = "";
  acceptedCandidateIds.value = new Set();
  seenCandidateIds.value = new Set();
  preApplyValues.value = new Map();
  recognitionOpen.value = false;
  form.value = {
    name: "",
    brand: "",
    categoryId: "",
    locationId:
      props.selectedLocationId ||
      props.family?.locations.find((location) => location.isDefault)?.id ||
      props.family?.locations[0]?.id ||
      "",
    quantity: 1,
    unit: "件",
    specification: "",
    ingredients: "",
    purchasedAt: today,
    productionDate: "",
    shelfLifeValue: "",
    shelfLifeUnit: "month",
    expirationDate: "",
    unitPrice: "",
    channel: "",
    lowStockThreshold: ""
  };
  uploads.value = {
    product: { file: null, preview: "", progress: 0, state: "idle", error: "" },
    label: { file: null, preview: "", progress: 0, state: "idle", error: "" },
    date: { file: null, preview: "", progress: 0, state: "idle", error: "" }
  };
}

function mediaUrl(mediaId: string) {
  return apiUrl(`media/${mediaId}`);
}

function setFromValues(values: Record<string, unknown>) {
  const keys = Object.keys(form.value) as Array<keyof typeof form.value>;
  for (const key of keys) {
    const value = values[key];
    if (key === "quantity" && (typeof value === "string" || typeof value === "number")) {
      const quantity = Number(value);
      form.value.quantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      (form.value[key] as string | number) = value;
    }
  }
  const shelfLife = values.shelfLife;
  if (shelfLife && typeof shelfLife === "object" && !Array.isArray(shelfLife)) {
    const data = shelfLife as { value?: unknown; unit?: unknown };
    if (typeof data.value === "number") form.value.shelfLifeValue = String(data.value);
    if (typeof data.unit === "string") form.value.shelfLifeUnit = data.unit;
  }
}

function currentFieldValue(fieldKey: string): unknown {
  if (fieldKey === "shelfLife") {
    return {
      value: form.value.shelfLifeValue === "" ? null : Number(form.value.shelfLifeValue),
      unit: form.value.shelfLifeUnit
    };
  }
  if (fieldKey in form.value) {
    return form.value[fieldKey as keyof typeof form.value];
  }
  return undefined;
}

function applyCandidate(candidate: Candidate) {
  if (!preApplyValues.value.has(candidate.id)) {
    preApplyValues.value.set(candidate.id, currentFieldValue(candidate.fieldKey));
  }
  const value = candidate.value;
  if (candidate.fieldKey === "shelfLife" && value && typeof value === "object") {
    const shelfLife = value as { value?: unknown; unit?: unknown };
    form.value.shelfLifeValue = typeof shelfLife.value === "number" ? String(shelfLife.value) : "";
    form.value.shelfLifeUnit = typeof shelfLife.unit === "string" ? shelfLife.unit : "month";
  } else if (candidate.fieldKey in form.value && (typeof value === "string" || typeof value === "number")) {
    const key = candidate.fieldKey as keyof typeof form.value;
    (form.value[key] as string | number) = value;
  }
  acceptedCandidateIds.value = new Set([...acceptedCandidateIds.value, candidate.id]);
}

function revertCandidate(candidate: Candidate) {
  const previous = preApplyValues.value.get(candidate.id);
  if (candidate.fieldKey === "shelfLife") {
    const data = (previous || {}) as { value?: unknown; unit?: unknown };
    form.value.shelfLifeValue = typeof data.value === "number" ? String(data.value) : "";
    form.value.shelfLifeUnit = typeof data.unit === "string" ? data.unit : "month";
  } else if (
    candidate.fieldKey in form.value &&
    (typeof previous === "string" || typeof previous === "number")
  ) {
    const key = candidate.fieldKey as keyof typeof form.value;
    (form.value[key] as string | number) = previous;
  }
  preApplyValues.value.delete(candidate.id);
  const next = new Set(acceptedCandidateIds.value);
  next.delete(candidate.id);
  acceptedCandidateIds.value = next;
}

function toggleCandidate(candidate: Candidate) {
  if (acceptedCandidateIds.value.has(candidate.id)) {
    revertCandidate(candidate);
  } else {
    applyCandidate(candidate);
  }
}

function hydrateDetail(data: IntakeDetail) {
  if (hydratedDraftId.value !== data.id) {
    setFromValues(data.userValues || {});
    hydratedDraftId.value = data.id;
  }
  if (!form.value.categoryId && data.categoryId) form.value.categoryId = data.categoryId;
  if (!form.value.locationId && data.locationId) form.value.locationId = data.locationId;
  for (const candidate of data.candidates) {
    if (seenCandidateIds.value.has(candidate.id)) continue;
    const current = form.value[candidate.fieldKey as keyof typeof form.value];
    if ((candidate.basedOnVersion === undefined || candidate.basedOnVersion === data.version) && (current === "" || current === undefined)) {
      applyCandidate(candidate);
    }
    seenCandidateIds.value = new Set([...seenCandidateIds.value, candidate.id]);
  }
}

async function loadDetail(showLoader = false) {
  if (!draftId.value) return;
  if (showLoader) loading.value = true;
  try {
    const previousStatus = detail.value?.status;
    const data = await request<IntakeDetail>(`intakes/${draftId.value}`);
    detail.value = data;
    hydrateDetail(data);
    if (previousStatus && previousStatus !== "completed" && data.status === "completed") {
      emit("completed");
    }
    emit("updated");
    schedulePoll();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "草稿加载失败";
  } finally {
    loading.value = false;
  }
}

function schedulePoll() {
  if (pollTimer) window.clearTimeout(pollTimer);
  const status = detail.value?.status;
  if (!props.open || !draftId.value || ["needs_review", "completed", "cancelled"].includes(status || "")) {
    return;
  }
  pollTimer = window.setTimeout(() => {
    if (document.hidden) {
      schedulePoll();
      return;
    }
    void loadDetail();
  }, 5000);
}

async function ensureDraft() {
  if (draftId.value) return draftId.value;
  if (!props.family?.id) {
    throw new Error("当前家庭不可用");
  }
  const created = await request<IntakeDetail>("intakes", {
    method: "POST",
    body: JSON.stringify({
      familyId: props.family.id,
      locationId: form.value.locationId,
      categoryId: form.value.categoryId,
      userValues: { ...form.value }
    })
  });
  draftId.value = created.id;
  detail.value = created;
  emit("updated");
  return created.id;
}

function saveDraftValues(): Promise<void> {
  if (!draftId.value || detail.value?.status === "completed") return Promise.resolve();
  if (savePromise) {
    savePending = true;
    return savePromise.then(() => (savePending ? saveDraftValues() : undefined));
  }

  savePending = false;
  savingDraft.value = true;
  const values = { ...form.value, quantity: Number(form.value.quantity) || 1 };
  savePromise = request(`intakes/${draftId.value}`, {
    method: "PATCH",
    body: JSON.stringify({ values })
  })
    .then(() => undefined)
    .catch((err) => {
      error.value = err instanceof Error ? err.message : "草稿保存失败";
    })
    .finally(() => {
      savingDraft.value = false;
      savePromise = null;
    });
  return savePromise;
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片预处理失败"));
    };
    image.src = objectUrl;
  });
}

async function createCoverThumbnail(file: File) {
  try {
    const image = await loadImageElement(file);
    const size = 120;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight) return null;

    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = Math.max(0, Math.round((image.naturalWidth - sourceSize) / 2));
    const sourceY = Math.max(0, Math.round((image.naturalHeight - sourceSize) / 2));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.78);
    });
  } catch {
    return null;
  }
}

async function uploadWithProgress(intakeId: string, role: ImageRole, file: File) {
  const thumbnail = await createCoverThumbnail(file);
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const data = new FormData();
    data.append("imageRole", role);
    data.append("image", file);
    if (thumbnail) {
      data.append("thumbnail", thumbnail, "cover-120.jpg");
    }
    xhr.open("POST", apiUrl(`intakes/${intakeId}/images`));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        uploads.value[role].progress = Math.round((event.loaded / event.total) * 100);
      }
    };
    xhr.onerror = () => reject(new Error("图片上传失败，请检查网络"));
    xhr.onload = () => {
      let payload: ApiResponse<unknown> | null = null;
      try {
        payload = JSON.parse(xhr.responseText) as ApiResponse<unknown>;
      } catch {
        reject(new Error("服务器返回了无效响应"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !payload.ok) {
        reject(new Error(payload.error?.message || payload.statusMessage || "图片上传失败"));
        return;
      }
      resolve();
    };
    xhr.send(data);
  });
}

async function selectImage(role: ImageRole, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    uploads.value[role].error = "仅支持 JPEG、PNG 和 WebP";
    uploads.value[role].state = "failed";
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    uploads.value[role].error = "图片不能超过 12 MB";
    uploads.value[role].state = "failed";
    return;
  }

  const oldPreview = uploads.value[role].preview;
  if (oldPreview.startsWith("blob:")) URL.revokeObjectURL(oldPreview);
  uploads.value[role] = {
    file,
    preview: URL.createObjectURL(file),
    progress: 0,
    state: "uploading",
    error: ""
  };
  error.value = "";

  try {
    const intakeId = await ensureDraft();
    await uploadWithProgress(intakeId, role, file);
    uploads.value[role].state = "uploaded";
    uploads.value[role].progress = 100;
    await loadDetail();
  } catch (err) {
    uploads.value[role].state = "failed";
    uploads.value[role].error = err instanceof Error ? err.message : "图片上传失败";
  }
}

function setFileInput(role: ImageRole, el: Element | null) {
  if (el instanceof HTMLInputElement) {
    fileInputs[role] = el;
  }
}

function retryUpload(role: ImageRole) {
  uploads.value[role].error = "";
  uploads.value[role].state = "idle";
  fileInputs[role]?.click();
}

async function retryJobs() {
  if (!draftId.value) return;
  submitting.value = true;
  error.value = "";
  try {
    await request(`intakes/${draftId.value}/retry`, { method: "POST", body: "{}" });
    await loadDetail();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "重试失败";
  } finally {
    submitting.value = false;
  }
}

async function rerunOcr() {
  if (!draftId.value || rerunningOcr.value) return;
  rerunningOcr.value = true;
  error.value = "";
  try {
    await saveDraftValues();
    await request(`intakes/${draftId.value}/ocr/rerun`, { method: "POST", body: "{}" });
    acceptedCandidateIds.value = new Set();
    seenCandidateIds.value = new Set();
    preApplyValues.value = new Map();
    recognitionOpen.value = true;
    await loadDetail();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "重新 OCR 识别失败";
  } finally {
    rerunningOcr.value = false;
  }
}

async function reextractAi() {
  if (!draftId.value || reextractingAi.value) return;
  reextractingAi.value = true;
  error.value = "";
  try {
    await saveDraftValues();
    await request(`intakes/${draftId.value}/ai/reextract`, { method: "POST", body: "{}" });
    acceptedCandidateIds.value = new Set();
    seenCandidateIds.value = new Set();
    preApplyValues.value = new Map();
    await loadDetail();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "重新 AI 提取失败";
  } finally {
    reextractingAi.value = false;
  }
}

async function completeIntake() {
  if (!draftId.value) return;
  submitting.value = true;
  error.value = "";
  try {
    const allCandidateIds = detail.value?.candidates.map((item) => item.id) || [];
    const accepted = [...acceptedCandidateIds.value];
    await request(`intakes/${draftId.value}/complete`, {
      method: "POST",
      body: JSON.stringify({
        values: {
          ...form.value,
          quantity: Number(form.value.quantity) || 1,
          shelfLifeValue: form.value.shelfLifeValue || null,
          shelfLifeUnit: form.value.shelfLifeValue ? form.value.shelfLifeUnit : null
        },
        acceptedCandidateIds: accepted,
        rejectedCandidateIds: allCandidateIds.filter((id) => !accepted.includes(id))
      })
    });
    emit("completed");
    emit("updated");
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "确认入库失败";
  } finally {
    submitting.value = false;
  }
}

async function close() {
  if (hasUploading.value || submitting.value) return;
  if (saveTimer) window.clearTimeout(saveTimer);
  await saveDraftValues();
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    void close();
  }
}

function formatCandidateValue(candidate: Candidate) {
  if (candidate.fieldKey === "categoryId") {
    return props.categories.find((category) => category.id === candidate.value)?.name || String(candidate.value ?? "");
  }
  if (candidate.fieldKey === "shelfLife" && candidate.value && typeof candidate.value === "object") {
    const data = candidate.value as { value?: number; unit?: string };
    const unit = data.unit === "day" ? "天" : data.unit === "year" ? "年" : "个月";
    return `${data.value ?? ""}${unit}`;
  }
  return String(candidate.value ?? "");
}

function sourceLabel(source: string) {
  return {
    barcode: "条码",
    ocr_rule: "OCR 规则",
    computed: "自动计算",
    ai: "AI 整理"
  }[source] || source;
}

function roleLabel(role?: string) {
  return {
    product: "商品主体",
    label: "配料与标签",
    date: "生产日期"
  }[role || ""] || "图片";
}

function imageRoleForResult(result: OcrResult) {
  return detail.value?.media.find((item) => item.id === result.imageId)?.imageRole;
}

function confidenceLabel(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function fieldLabel(key: string) {
  return {
    categoryId: "品类",
    name: "商品名称",
    brand: "品牌",
    productionDate: "生产日期",
    shelfLife: "保质期",
    expirationDate: "到期日期",
    specification: "规格",
    ingredients: "配料"
  }[key] || key;
}

watch(
  () => props.open,
  async (open) => {
    if (pollTimer) window.clearTimeout(pollTimer);
    if (open) {
      window.addEventListener("keydown", onKeydown);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
    if (!open) return;
    reset();
    if (props.intakeId) {
      draftId.value = props.intakeId;
      await loadDetail(true);
    }
  }
);

watch(
  form,
  () => {
    if (!props.open || !draftId.value || detail.value?.status === "completed") return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveDraftValues(), 800);
  },
  { deep: true }
);

watch(
  () => form.value.categoryId,
  () => {
    if (!selectedCategory.value) return;
    if (!form.value.unit || form.value.unit === "件") {
      form.value.unit = selectedCategory.value.fields.defaultUnit;
    }
    if (!selectedCategory.value.fields.expirationEnabled) {
      form.value.productionDate = "";
      form.value.shelfLifeValue = "";
      form.value.expirationDate = "";
    }
  }
);

onBeforeUnmount(() => {
  if (pollTimer) window.clearTimeout(pollTimer);
  if (saveTimer) window.clearTimeout(saveTimer);
  window.removeEventListener("keydown", onKeydown);
  for (const item of Object.values(uploads.value)) {
    if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  }
});
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="close">
    <section class="modal photo-intake-modal" role="dialog" aria-modal="true" aria-labelledby="photo-intake-title">
      <header class="modal-header">
        <div>
          <h2 id="photo-intake-title">{{ draftId ? "拍照录入草稿" : "拍照录入" }}</h2>
          <p>图片保存后可关闭窗口，识别任务会在后台继续</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭" :disabled="hasUploading" @click="close">
          <X :size="20" />
        </button>
      </header>

      <div v-if="loading" class="photo-loading">
        <LoaderCircle class="spin" :size="26" />
        <span>正在加载草稿</span>
      </div>

      <form v-else class="photo-intake-body" @submit.prevent="completeIntake">
        <section v-if="detail" class="recognition-section">
          <button class="recognition-toggle" type="button" @click="recognitionOpen = !recognitionOpen">
            <FileSearch :size="17" />
            <span>
              <strong>入库信息 / 识别内容</strong>
              <small>
                {{ recognizedCandidateCount }} 个候选字段 · {{ recognizedLineCount }} 行 OCR 原文
              </small>
            </span>
            <em>{{ recognitionOpen ? "收起" : "查看" }}</em>
          </button>

          <div v-if="recognitionOpen" class="recognition-detail">
            <div class="recognition-actions">
              <div>
                <strong>对当前提取结果不满意？</strong>
                <span>OCR 原文不完整时可重跑 OCR；OCR 正常但字段不准时只需重新 AI 提取。</span>
              </div>
              <div class="recognition-action-buttons">
                <button type="button" class="secondary" :disabled="!canRerunOcr || rerunningOcr" @click="rerunOcr">
                  <LoaderCircle v-if="rerunningOcr" class="spin" :size="14" />
                  <RefreshCw v-else :size="14" />
                  {{ rerunningOcr ? "正在提交" : "重新 OCR 识别" }}
                </button>
                <button type="button" :disabled="!canReextractAi || reextractingAi" @click="reextractAi">
                  <LoaderCircle v-if="reextractingAi" class="spin" :size="14" />
                  <RefreshCw v-else :size="14" />
                  {{ reextractingAi ? "正在提交" : "重新 AI 提取" }}
                </button>
              </div>
            </div>

            <div class="recognized-fields">
              <h3>当前入库字段</h3>
              <dl>
                <div><dt>商品名称</dt><dd>{{ form.name || "未识别/未填写" }}</dd></div>
                <div><dt>品类</dt><dd>{{ selectedCategory?.name || "未确认" }}</dd></div>
                <div><dt>品牌</dt><dd>{{ form.brand || "未识别" }}</dd></div>
                <div><dt>规格</dt><dd>{{ form.specification || "未识别" }}</dd></div>
                <div><dt>生产日期</dt><dd>{{ form.productionDate || "未识别" }}</dd></div>
                <div><dt>保质期</dt><dd>{{ form.shelfLifeValue ? `${form.shelfLifeValue}${form.shelfLifeUnit === 'day' ? '天' : form.shelfLifeUnit === 'year' ? '年' : '个月'}` : "未识别" }}</dd></div>
                <div><dt>到期日期</dt><dd>{{ form.expirationDate || "未识别" }}</dd></div>
                <div><dt>配料</dt><dd>{{ form.ingredients || "未识别" }}</dd></div>
              </dl>
            </div>

            <div class="recognized-fields">
              <h3>候选字段</h3>
              <div v-if="detail.candidates.length" class="recognized-candidates">
                <button
                  v-for="candidate in detail.candidates"
                  :key="candidate.id"
                  type="button"
                  :class="{ selected: acceptedCandidateIds.has(candidate.id) }"
                  @click="toggleCandidate(candidate)"
                >
                  <strong>{{ fieldLabel(candidate.fieldKey) }}：{{ formatCandidateValue(candidate) }}</strong>
                  <small>{{ sourceLabel(candidate.source) }} · {{ confidenceLabel(candidate.confidence) }}</small>
                  <span>{{ candidate.evidence.sourceText || "无来源文本" }}</span>
                </button>
              </div>
              <p v-else class="empty-recognition">暂无候选字段，可能还在识别中，或 OCR 原文不足以提取字段。</p>
            </div>

            <div class="recognized-fields span-2">
              <h3>OCR 原文</h3>
              <div v-if="detail.ocrResults.length" class="ocr-line-groups">
                <article v-for="result in detail.ocrResults" :key="result.id">
                  <header>
                    <strong>{{ roleLabel(imageRoleForResult(result)) }}</strong>
                    <small>{{ result.engine }} · {{ result.modelVersion }} · {{ result.lines.length }} 行</small>
                  </header>
                  <ol>
                    <li v-for="(line, index) in result.lines" :key="`${result.id}-${line.id || index}`">
                      <span>{{ line.text || "空文本" }}</span>
                      <em>{{ confidenceLabel(line.confidence) }}</em>
                    </li>
                  </ol>
                </article>
              </div>
              <p v-else class="empty-recognition">暂无 OCR 原文，图片可能仍在排队或 OCR 任务未完成。</p>
            </div>
          </div>
        </section>

        <section class="photo-steps" aria-label="商品图片">
          <article v-for="role in roles" :key="role.key" class="photo-step">
            <div class="step-heading">
              <span>{{ role.step }}</span>
              <div><strong>{{ role.title }}</strong><small>{{ role.description }}</small></div>
              <Check v-if="uploads[role.key].state === 'uploaded' || detail?.media.some((item) => item.imageRole === role.key)" :size="18" />
            </div>
            <div class="image-picker">
              <img
                v-if="uploads[role.key].preview || detail?.media.find((item) => item.imageRole === role.key)"
                :src="uploads[role.key].preview || mediaUrl(detail!.media.find((item) => item.imageRole === role.key)!.id)"
                :alt="role.title"
              />
              <div v-else class="image-placeholder">
                <Camera :size="25" />
                <span>拍照或选择图片</span>
              </div>
              <label class="image-action">
                <ImagePlus :size="16" />
                <span>{{ detail?.media.some((item) => item.imageRole === role.key) ? "重新上传" : "选择图片" }}</span>
                <input
                  :ref="(el) => setFileInput(role.key, el as Element | null)"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  :disabled="uploads[role.key].state === 'uploading'"
                  @change="selectImage(role.key, $event)"
                />
              </label>
            </div>
            <div v-if="uploads[role.key].state === 'uploading'" class="upload-progress">
              <div><span :style="{ width: `${uploads[role.key].progress}%` }"></span></div>
              <small><UploadCloud :size="13" />上传中 {{ uploads[role.key].progress }}%</small>
            </div>
            <div v-if="uploads[role.key].error" class="upload-error-row">
              <p class="upload-error">{{ uploads[role.key].error }}</p>
              <button type="button" class="upload-retry" @click="retryUpload(role.key)">
                <RefreshCw :size="13" />重试
              </button>
            </div>
          </article>
        </section>

        <div v-if="detail" :class="['pipeline-state', statusInfo.tone]">
          <LoaderCircle v-if="['ocr_processing', 'queued', 'retry_wait', 'ai_queued', 'ai_processing'].includes(detail.processingStage || '')" class="spin" :size="18" />
          <Clock3 v-else-if="detail.processingStage === 'waiting_runtime'" :size="18" />
          <CheckCircle2 v-else-if="detail.status === 'needs_review' || detail.status === 'completed'" :size="18" />
          <TriangleAlert v-else-if="detail.status === 'failed'" :size="18" />
          <FileSearch v-else :size="18" />
          <div>
            <strong>{{ statusInfo.label }}</strong>
            <span v-if="detail.processingStage === 'waiting_runtime'">图片和任务已保存，安装 OCR 环境后可重试</span>
            <span v-else-if="detail.processingStage === 'ai_processing' || detail.processingStage === 'ai_queued'">OCR 已完成，AI 将补充不确定字段</span>
            <span v-else-if="detail.status === 'completed'">AI 信息完整，已自动入库成功</span>
            <span v-else>已上传 {{ detail.media.length }} 张，完成 {{ detail.jobs.filter((job) => job.jobType === 'ocr' && job.status === 'completed').length }} 个 OCR 任务</span>
          </div>
          <div v-if="detail.status === 'failed' || detail.processingStage === 'waiting_runtime' || canRerunOcr || canReextractAi" class="pipeline-actions">
            <button v-if="canRerunOcr" type="button" :disabled="rerunningOcr" @click="rerunOcr">
              <LoaderCircle v-if="rerunningOcr" class="spin" :size="15" />
              <RefreshCw v-else :size="15" />
              {{ rerunningOcr ? "提交中" : "重新 OCR" }}
            </button>
            <button v-if="canReextractAi" type="button" :disabled="reextractingAi" @click="reextractAi">
              <LoaderCircle v-if="reextractingAi" class="spin" :size="15" />
              <RefreshCw v-else :size="15" />
              {{ reextractingAi ? "提交中" : "重新 AI 提取" }}
            </button>
            <button v-if="detail.status === 'failed' || detail.processingStage === 'waiting_runtime'" type="button" :disabled="submitting" @click="retryJobs">
              <RefreshCw :size="15" />重试
            </button>
          </div>
        </div>

        <section class="purchase-section">
          <header>
            <div>
              <h3>补充购买信息</h3>
              <p>可在图片识别期间填写，未填写项稍后也能确认</p>
            </div>
          </header>
          <div class="form-grid purchase-fields">
            <label class="field">
              <span>数量 <em>*</em></span>
              <QuantityInput v-model="form.quantity" required :min="0.01" />
            </label>
            <label class="field"><span>单位 <em>*</em></span><input v-model.trim="form.unit" required maxlength="12" /></label>
            <label class="field"><span>购买价格</span><input v-model="form.unitPrice" min="0" step="0.01" type="number" placeholder="单件价格" /></label>
            <label class="field"><span>购买渠道</span><input v-model.trim="form.channel" maxlength="50" placeholder="例如：线下超市" /></label>
            <label class="field purchase-date-field"><span>购买日期</span><input v-model="form.purchasedAt" type="date" /></label>
          </div>
        </section>

        <section v-if="canReview" class="review-section">
          <header>
            <div>
              <h3>确认识别结果</h3>
              <p>识别值只是建议，可直接修改后入库；再次点击已应用项可恢复原值</p>
            </div>
            <span>{{ detail?.candidates.length || 0 }} 个候选字段</span>
          </header>

          <div v-if="detail?.candidates.length" class="candidate-list">
            <button
              v-for="candidate in detail.candidates"
              :key="candidate.id"
              type="button"
              :class="{ selected: acceptedCandidateIds.has(candidate.id) }"
              @click="toggleCandidate(candidate)"
            >
                <span class="candidate-check"><Check :size="14" /></span>
              <span>
                <strong>{{ fieldLabel(candidate.fieldKey) }}：{{ formatCandidateValue(candidate) }}</strong>
                <small>{{ candidate.evidence.sourceText || "规则解析结果" }}</small>
              </span>
              <em v-if="acceptedCandidateIds.has(candidate.id)" class="applied-tag">已应用 · 点击撤销</em>
              <em v-else>{{ Math.round((candidate.confidence || 0) * 100) }}%</em>
            </button>
          </div>

          <div class="form-grid review-fields">
            <label class="field span-2">
              <span>商品名称 <em>*</em></span>
              <input v-model.trim="form.name" required maxlength="80" placeholder="请输入或确认商品名称" />
            </label>
            <label class="field span-2">
              <span>品类 <em>*</em></span>
              <select v-model="form.categoryId" required>
                <option value="" disabled>识别后请确认品类</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
              </select>
            </label>
            <label class="field"><span>品牌</span><input v-model.trim="form.brand" maxlength="50" /></label>
            <label class="field"><span>规格</span><input v-model.trim="form.specification" maxlength="40" /></label>
            <label v-if="selectedCategory?.fields.enabled.includes('ingredients')" class="field span-2">
              <span>配料</span><textarea v-model.trim="form.ingredients" maxlength="2000" rows="3"></textarea>
            </label>
            <label v-if="selectedCategory?.fields.expirationEnabled" class="field">
              <span>生产日期</span><input v-model="form.productionDate" type="date" />
            </label>
            <template v-if="selectedCategory?.fields.expirationEnabled">
              <label class="field">
                <span>保质期</span>
                <input v-model="form.shelfLifeValue" min="1" step="1" type="number" />
              </label>
              <label class="field">
                <span>保质期单位</span>
                <select v-model="form.shelfLifeUnit">
                  <option value="day">天</option><option value="month">个月</option><option value="year">年</option>
                </select>
              </label>
              <label class="field"><span>到期日期</span><input v-model="form.expirationDate" type="date" /></label>
            </template>
            <label class="field span-2">
              <span>存放地点 <em>*</em></span>
              <select v-model="form.locationId" required>
                <option value="" disabled>请选择存放地点</option>
                <option v-for="location in family?.locations || []" :key="location.id" :value="location.id">
                  {{ location.name }}
                </option>
              </select>
            </label>
          </div>
        </section>

        <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

        <footer class="modal-footer">
          <p v-if="detail?.status === 'completed'"><CheckCircle2 :size="15" />已自动入库，可关闭窗口</p>
          <p v-else-if="draftId && !canReview"><CheckCircle2 :size="15" />草稿已保存，可稍后继续</p>
          <button class="cancel-button" type="button" :disabled="hasUploading || submitting" @click="close">
            {{ draftId ? "关闭" : "取消" }}
          </button>
          <button v-if="canReview" class="primary-button" type="submit" :disabled="submitting">
            <LoaderCircle v-if="submitting" class="spin" :size="18" />
            <CheckCircle2 v-else :size="18" />
            {{ submitting ? "正在入库" : "确认并入库" }}
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.photo-intake-modal {
  display: flex;
  max-height: calc(100vh - 48px);
  max-height: calc(100dvh - 48px);
  width: min(920px, 100%);
  flex-direction: column;
  overflow: hidden;
}
.photo-intake-modal .modal-header {
  flex: 0 0 auto;
}
.photo-intake-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 22px;
}
.recognition-section {
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-soft);
}
.recognition-toggle {
  display: grid;
  width: 100%;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 12px 13px;
  text-align: left;
}
.recognition-toggle > svg { color: var(--green); }
.recognition-toggle strong,
.recognition-toggle small { display: block; }
.recognition-toggle strong { font-size: 12px; }
.recognition-toggle small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}
.recognition-toggle em {
  border-radius: 999px;
  background: var(--surface);
  color: var(--green);
  padding: 4px 8px;
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
}
.recognition-detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  border-top: 1px solid var(--line);
  padding: 12px;
}
.recognition-actions {
  display: flex;
  grid-column: span 2;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  padding: 10px 11px;
}
.recognition-actions strong,
.recognition-actions span {
  display: block;
}
.recognition-actions strong {
  font-size: 12px;
}
.recognition-actions span {
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}
.recognition-action-buttons {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}
.recognition-actions button {
  display: inline-flex;
  min-height: 30px;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--green);
  border-radius: 6px;
  background: var(--green);
  color: white;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 800;
}
.recognition-actions button.secondary {
  border-color: var(--line-strong);
  background: var(--surface);
  color: var(--text);
}
.recognized-fields {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  padding: 11px;
}
.recognized-fields.span-2 { grid-column: span 2; }
.recognized-fields h3 {
  margin: 0 0 10px;
  font-size: 12px;
}
.recognized-fields dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.recognized-fields dt {
  color: var(--muted);
  font-size: 9px;
}
.recognized-fields dd {
  overflow-wrap: anywhere;
  margin: 3px 0 0;
  font-size: 11px;
}
.recognized-candidates {
  display: grid;
  gap: 7px;
}
.recognized-candidates button {
  display: grid;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  padding: 8px;
  text-align: left;
}
.recognized-candidates button.selected {
  border-color: #8fb19c;
  background: var(--green-soft);
}
.recognized-candidates strong,
.recognized-candidates small,
.recognized-candidates span { display: block; }
.recognized-candidates strong {
  overflow-wrap: anywhere;
  font-size: 11px;
}
.recognized-candidates small,
.recognized-candidates span {
  color: var(--muted);
  font-size: 9px;
}
.recognized-candidates span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ocr-line-groups {
  display: grid;
  gap: 9px;
}
.ocr-line-groups article {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 9px;
}
.ocr-line-groups header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ocr-line-groups header strong { font-size: 11px; }
.ocr-line-groups header small {
  color: var(--muted);
  font-size: 9px;
}
.ocr-line-groups ol {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding-left: 18px;
}
.ocr-line-groups li {
  min-width: 0;
  color: var(--text);
  font-size: 10px;
}
.ocr-line-groups li span { overflow-wrap: anywhere; }
.ocr-line-groups li em {
  margin-left: 6px;
  color: var(--muted);
  font-size: 9px;
  font-style: normal;
}
.empty-recognition {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
}
.pipeline-state {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 11px 13px;
}
.pipeline-state strong,
.pipeline-state span {
  display: block;
}
.pipeline-state strong {
  font-size: 12px;
}
.pipeline-state span {
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}
.pipeline-state.notice { background: var(--blue-soft); color: var(--blue); }
.pipeline-state.warning { background: var(--amber-soft); color: var(--amber); }
.pipeline-state.danger { background: var(--red-soft); color: var(--red); }
.pipeline-state.success { background: var(--green-soft); color: var(--green); }
.pipeline-state button {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.pipeline-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}
.photo-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 0;
}
.photo-step {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}
.step-heading {
  display: grid;
  min-height: 48px;
  grid-template-columns: 25px minmax(0, 1fr) 18px;
  align-items: start;
  gap: 8px;
}
.step-heading > span {
  display: grid;
  width: 23px;
  height: 23px;
  place-items: center;
  border-radius: 50%;
  background: var(--green-soft);
  color: var(--green);
  font-size: 11px;
  font-weight: 800;
}
.step-heading strong,
.step-heading small {
  display: block;
}
.step-heading strong { font-size: 12px; }
.step-heading small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.4;
}
.step-heading > svg { color: var(--green); }
.image-picker {
  position: relative;
  display: grid;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  place-items: center;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  background: var(--surface-soft);
}
.image-picker img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.image-placeholder {
  display: grid;
  place-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 10px;
}
.image-action {
  position: absolute;
  right: 7px;
  bottom: 7px;
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--text);
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}
.image-action input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}
.upload-progress { margin-top: 8px; }
.upload-progress > div {
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--line);
}
.upload-progress > div span {
  display: block;
  height: 100%;
  background: var(--green);
}
.upload-progress small {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  color: var(--muted);
  font-size: 9px;
}
.upload-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
}
.upload-error {
  margin: 0;
  color: var(--red);
  font-size: 10px;
}
.upload-retry {
  display: inline-flex;
  min-height: 26px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--red);
  border-radius: 5px;
  background: transparent;
  color: var(--red);
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
}
.review-section {
  margin-top: 20px;
  border-top: 1px solid var(--line);
  padding-top: 18px;
}
.purchase-section {
  margin-top: 18px;
  border-top: 1px solid var(--line);
  padding-top: 17px;
}
.purchase-section h3,
.purchase-section p { margin: 0; }
.purchase-section h3 { font-size: 14px; }
.purchase-section p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 10px;
}
.purchase-fields {
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 0.55fr) minmax(0, 0.8fr) minmax(0, 1fr) minmax(0, 0.95fr);
  gap: 10px;
  margin-top: 13px;
}

.photo-intake-body .field,
.purchase-fields .field {
  min-width: 0;
}

.photo-intake-body .field input,
.photo-intake-body .field select,
.photo-intake-body .field textarea,
.purchase-fields .field input {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.purchase-date-field input[type="date"],
.review-fields input[type="date"] {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  appearance: none;
  -webkit-appearance: none;
}
.review-section > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.review-section h3,
.review-section p { margin: 0; }
.review-section h3 { font-size: 15px; }
.review-section p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 10px;
}
.review-section > header > span {
  border-radius: 5px;
  background: var(--green-soft);
  color: var(--green);
  padding: 4px 7px;
  font-size: 10px;
  font-weight: 700;
}
.candidate-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 13px;
}
.candidate-list button {
  display: grid;
  min-width: 0;
  min-height: 58px;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  padding: 8px;
  text-align: left;
}
.candidate-list button.selected {
  border-color: #8fb19c;
  background: var(--green-soft);
}
.candidate-check {
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  color: transparent;
}
.candidate-list button.selected .candidate-check {
  border-color: var(--green);
  background: var(--green);
  color: white;
}
.candidate-list strong,
.candidate-list small { display: block; }
.candidate-list strong {
  overflow-wrap: anywhere;
  font-size: 11px;
}
.candidate-list small {
  margin-top: 3px;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
}
.candidate-list em {
  color: var(--muted);
  font-size: 9px;
  font-style: normal;
}
.candidate-list em.applied-tag {
  color: var(--green);
  font-weight: 700;
  text-align: right;
}
.review-fields { margin-top: 15px; }
.modal-footer > p {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--green);
  font-size: 10px;
}
.photo-intake-body .modal-footer {
  position: sticky;
  bottom: -20px;
  z-index: 1;
  margin: 18px -22px -20px;
  background: var(--surface);
  padding: 14px 22px max(14px, env(safe-area-inset-bottom));
}
.photo-loading {
  display: grid;
  flex: 1 1 auto;
  min-height: min(300px, 60dvh);
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 760px) {
  .photo-intake-modal {
    max-height: 92vh;
    max-height: 92dvh;
  }
  .photo-intake-body { padding: 16px; }
  .photo-intake-body .modal-footer {
    bottom: -16px;
    margin: 16px -16px -16px;
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }
  .recognition-detail,
  .recognized-fields dl {
    grid-template-columns: 1fr;
  }
  .recognition-actions {
    grid-column: span 1;
    align-items: stretch;
    flex-direction: column;
  }
  .recognition-actions button {
    justify-content: center;
  }
  .recognized-fields.span-2 {
    grid-column: span 1;
  }
  .photo-steps,
  .candidate-list { grid-template-columns: 1fr; }
  .photo-step {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 132px;
    gap: 10px;
  }
  .photo-step .step-heading { align-self: center; }
  .photo-step .image-picker { width: 132px; }
  .photo-step .upload-progress,
  .photo-step .upload-error-row { grid-column: span 2; }
  .pipeline-state { grid-template-columns: 20px minmax(0, 1fr); }
  .pipeline-actions {
    grid-column: 2;
    justify-content: flex-start;
  }
  .purchase-fields {
    grid-template-columns: minmax(0, 1fr) minmax(72px, 0.72fr);
    gap: 10px;
  }
  .purchase-fields .field input,
  .purchase-fields .field select,
  .review-fields .field input,
  .review-fields .field select {
    font-size: 16px;
  }
  .purchase-fields .field:nth-child(3),
  .purchase-fields .field:nth-child(4),
  .purchase-date-field {
    grid-column: span 2;
  }
}
@media (max-width: 430px) {
  .photo-step {
    grid-template-columns: minmax(0, 1fr) 112px;
  }
  .photo-step .image-picker { width: 112px; }
  .photo-step .image-placeholder span { display: none; }
  .purchase-fields {
    grid-template-columns: minmax(0, 1fr) minmax(64px, 0.6fr);
  }
  .purchase-date-field input[type="date"] {
    padding-right: 8px;
  }
}
</style>
