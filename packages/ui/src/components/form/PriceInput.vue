<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
}>(), {
  placeholder: "0.00"
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <div class="input-prefix">
    <span>¥</span>
    <input
      :value="modelValue"
      min="0"
      step="0.01"
      type="number"
      inputmode="decimal"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </div>
</template>
