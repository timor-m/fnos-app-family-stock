<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: string;
  options: Array<string | { value: string; label: string }>;
  ariaLabel?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const normalized = computed(() =>
  props.options.map((option) => (typeof option === "string" ? { value: option, label: option } : option))
);
</script>

<template>
  <div class="choice-chips" role="listbox" :aria-label="ariaLabel">
    <button
      v-for="option in normalized"
      :key="option.value"
      type="button"
      role="option"
      :class="{ active: modelValue === option.value }"
      :aria-selected="modelValue === option.value"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
