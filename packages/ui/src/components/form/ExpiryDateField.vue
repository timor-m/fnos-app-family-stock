<script setup lang="ts">
import { computed } from "vue";
import { computeQuickExpiryDate } from "../../utils/format";
import DateField from "./DateField.vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  baseDate?: string;
  span?: boolean;
}>(), {
  baseDate: "",
  span: false
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const presets = [
  { label: "+3月", months: 3 },
  { label: "+6月", months: 6 },
  { label: "+1年", months: 12 },
  { label: "+2年", months: 24 }
];

const activeMonths = computed(() => {
  const match = presets.find((preset) => computeQuickExpiryDate(props.baseDate, preset.months) === props.modelValue);
  return match?.months ?? 0;
});

function apply(months: number) {
  emit("update:modelValue", computeQuickExpiryDate(props.baseDate, months));
}
</script>

<template>
  <div class="field" :class="{ 'span-2': span }">
    <span>到期日期</span>
    <div class="expiry-quick-presets expiry-quick-presets-first">
      <button
        v-for="preset in presets"
        :key="preset.months"
        type="button"
        :class="{ active: activeMonths === preset.months }"
        @click="apply(preset.months)"
      >
        {{ preset.label }}
      </button>
    </div>
    <DateField :model-value="modelValue" aria-label="到期日期" @update:model-value="emit('update:modelValue', $event)" />
  </div>
</template>
