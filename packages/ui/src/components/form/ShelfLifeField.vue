<script setup lang="ts">
defineProps<{
  modelValue: string;
  unit: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:unit": [value: string];
}>();
</script>

<template>
  <div class="field">
    <span>保质期</span>
    <div class="shelf-life-inline">
      <input
        :value="modelValue"
        min="1"
        step="1"
        type="number"
        inputmode="numeric"
        placeholder="数值"
        aria-label="保质期数值"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <div class="shelf-life-units" role="group" aria-label="保质期单位">
        <button type="button" :class="{ active: unit === 'day' }" @click="emit('update:unit', 'day')">天</button>
        <button type="button" :class="{ active: unit === 'month' }" @click="emit('update:unit', 'month')">月</button>
        <button type="button" :class="{ active: unit === 'year' }" @click="emit('update:unit', 'year')">年</button>
      </div>
    </div>
  </div>
</template>
