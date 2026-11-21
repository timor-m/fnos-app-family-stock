<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "@lucide/vue";
import ChoiceChips from "./form/ChoiceChips.vue";
import FormField from "./form/FormField.vue";
import ModalFrame from "./form/ModalFrame.vue";

type ManageMode =
  | "create-family"
  | "rename-family"
  | "create-location"
  | "rename-location"
  | "create-storage-place"
  | "rename-storage-place";

const props = defineProps<{
  open: boolean;
  mode: ManageMode;
  name: string;
  kind: string;
  currentFamilyName?: string;
  parentLocationName?: string;
  submitting: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (event: "update:name", value: string): void;
  (event: "update:kind", value: string): void;
  (event: "close"): void;
  (event: "submit"): void;
}>();

const nameInput = ref<HTMLInputElement | null>(null);

const title = computed(() => {
  if (props.mode === "create-family") return "新增家庭";
  if (props.mode === "rename-family") return "重命名家庭";
  if (props.mode === "rename-location") return "重命名地点";
  if (props.mode === "create-storage-place") return "新增细分存放位置";
  if (props.mode === "rename-storage-place") return "重命名细分存放位置";
  return "新增地点";
});

const isFamilyMode = computed(() => props.mode.includes("family"));
const isStoragePlaceMode = computed(() => props.mode.includes("storage-place"));

const helperText = computed(() => {
  if (isFamilyMode.value) return "家庭用于隔离成员和库存数据";
  if (isStoragePlaceMode.value) return `归属于“${props.parentLocationName || "当前地点"}”，例如厨房冰箱、客厅药箱、储物间二层`;
  return `归属于${props.currentFamilyName || "当前家庭"}`;
});

const fieldLabel = computed(() => {
  if (isFamilyMode.value) return "家庭名称";
  if (isStoragePlaceMode.value) return "存放位置名称";
  return "地点名称";
});

const placeholder = computed(() => {
  if (isFamilyMode.value) return "例如：上海的家";
  if (isStoragePlaceMode.value) return "例如：厨房冰箱 / 客厅电视柜 / 储物间二层";
  return "例如：广西老家";
});

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      nameInput.value?.focus();
    }
  }
);
</script>

<template>
  <ModalFrame :open="open" :title="title" :description="helperText" title-id="manage-title" compact @close="emit('close')">
    <form class="intake-form" @submit.prevent="emit('submit')">
      <div class="form-grid">
        <FormField :label="fieldLabel" required span>
          <input
            ref="nameInput"
            :value="name"
            required
            maxlength="50"
            :placeholder="placeholder"
            @input="emit('update:name', ($event.target as HTMLInputElement).value.trim())"
          />
        </FormField>
        <div v-if="mode === 'create-location'" class="field span-2">
          <span>地点类型</span>
          <ChoiceChips
            :model-value="kind"
            :options="[{ value: 'home', label: '住宅' }, { value: 'storage', label: '仓储' }, { value: 'other', label: '其他' }]"
            aria-label="地点类型"
            @update:model-value="emit('update:kind', $event)"
          />
        </div>
      </div>

      <p v-if="error" class="form-error"><TriangleAlert :size="16" />{{ error }}</p>

      <footer class="modal-footer">
        <button class="cancel-button" type="button" @click="emit('close')">取消</button>
        <button class="primary-button" type="submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="spin" :size="18" />
          <CheckCircle2 v-else :size="18" />
          {{ submitting ? "正在保存" : "保存" }}
        </button>
      </footer>
    </form>
  </ModalFrame>
</template>
