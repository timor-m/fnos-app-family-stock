<script setup lang="ts">
import { Minus, Plus } from "@lucide/vue";

const props = withDefaults(defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}>(), {
  min: 0,
  step: 1,
  required: false
});

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function update(value: number) {
  if (!Number.isFinite(value)) return;
  const maximum = props.max ?? Number.POSITIVE_INFINITY;
  const next = Math.min(maximum, Math.max(props.min, value));
  emit("update:modelValue", Number(next.toFixed(2)));
}
</script>

<template>
  <div class="quantity-input">
    <button type="button" aria-label="减少数量" :disabled="modelValue <= min" @click="update(modelValue - step)">
      <Minus :size="15" />
    </button>
    <input
      :value="modelValue"
      type="number"
      :required="required"
      :min="min"
      :max="max"
      step="any"
      @input="update(Number(($event.target as HTMLInputElement).value))"
    />
    <button type="button" aria-label="增加数量" :disabled="max !== undefined && modelValue >= max" @click="update(modelValue + step)">
      <Plus :size="15" />
    </button>
  </div>
</template>

<style scoped>
.quantity-input {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 38px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
}
.quantity-input button {
  display: grid;
  min-height: 39px;
  place-items: center;
  border: 0;
  background: var(--surface-soft);
  color: var(--text);
}
.quantity-input button:first-child { border-right: 1px solid var(--line); }
.quantity-input button:last-child { border-left: 1px solid var(--line); }
.quantity-input button:disabled { color: var(--muted); cursor: not-allowed; }
.quantity-input input {
  min-width: 0;
  height: 39px;
  border: 0;
  outline: 0;
  background: var(--surface);
  text-align: center;
  font: inherit;
  appearance: textfield;
}
.quantity-input input::-webkit-inner-spin-button { appearance: none; }
</style>
