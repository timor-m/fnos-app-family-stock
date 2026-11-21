<script setup lang="ts">
import { ref, watch } from "vue";
import { Check, LoaderCircle, Plus } from "@lucide/vue";
import { request } from "../../utils/api";
import type { StoragePlace } from "../../types/api";
import FormSelect from "./FormSelect.vue";

const props = withDefaults(defineProps<{
  locationId: string;
  modelValue: string;
  places: StoragePlace[];
  span?: boolean;
}>(), {
  span: true
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  created: [];
}>();

const creating = ref(false);
const saving = ref(false);
const name = ref("");
const error = ref("");

watch(
  () => props.locationId,
  () => {
    creating.value = false;
    name.value = "";
    error.value = "";
    if (props.modelValue && !props.places.some((place) => place.id === props.modelValue)) {
      emit("update:modelValue", "");
    }
  }
);

async function createPlace() {
  const nextName = name.value.trim();
  if (!nextName || !props.locationId || saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const result = await request<{ storagePlaceId: string }>(`locations/${props.locationId}/storage-places`, {
      method: "POST",
      body: JSON.stringify({ name: nextName })
    });
    emit("update:modelValue", result.storagePlaceId);
    name.value = "";
    creating.value = false;
    emit("created");
  } catch (err) {
    error.value = err instanceof Error ? err.message : "创建位置失败";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="field" :class="{ 'span-2': span }">
    <div class="field-label-row">
      <span>细分存放位置</span>
      <button v-if="!creating" class="inline-link-btn" type="button" @click="creating = true">
        <Plus :size="13" />新建位置
      </button>
    </div>
    <div v-if="creating" class="inline-place-creator">
      <input
        v-model.trim="name"
        maxlength="50"
        placeholder="例如：客厅药箱 / 厨房冰箱"
        aria-label="新存放位置名称"
        @keydown.enter.prevent="createPlace"
      />
      <button type="button" class="quick-action-btn finish" :disabled="saving || !name" @click="createPlace">
        <LoaderCircle v-if="saving" class="spin" :size="13" />
        <Check v-else :size="13" />保存
      </button>
      <button type="button" class="quick-action-btn" :disabled="saving" @click="creating = false">取消</button>
    </div>
    <FormSelect
      v-else
      :model-value="modelValue"
      :options="[{ value: '', label: '不指定具体位置' }, ...places.map((place) => ({ value: place.id, label: place.name }))]"
      aria-label="细分存放位置"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <small v-if="error" class="inline-field-error">{{ error }}</small>
  </div>
</template>
