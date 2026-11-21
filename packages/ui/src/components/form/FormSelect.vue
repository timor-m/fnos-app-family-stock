<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, ChevronDown } from "@lucide/vue";

type Option = { value: string; label: string; disabled?: boolean };

const props = withDefaults(defineProps<{
  modelValue: string;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}>(), {
  placeholder: "请选择",
  disabled: false,
  ariaLabel: "请选择"
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const layer = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const current = computed(() => props.options.find((option) => option.value === props.modelValue) || null);

function place() {
  if (!open.value) return;
  if (window.matchMedia("(max-width: 760px)").matches) {
    panelStyle.value = {};
    return;
  }
  const rect = root.value?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
  const below = window.innerHeight - rect.bottom - 16;
  const above = rect.top - 16;
  const flip = below < 180 && above > below;
  panelStyle.value = {
    position: "fixed",
    left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(120, Math.min(264, flip ? above : below))}px`,
    ...(flip ? { bottom: `${window.innerHeight - rect.top + 6}px` } : { top: `${rect.bottom + 6}px` })
  };
}

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(option: Option) {
  if (props.disabled || option.disabled) return;
  emit("update:modelValue", option.value);
  open.value = false;
}

function onPointerDown(event: Event) {
  const target = event.target as Node;
  if (root.value?.contains(target) || layer.value?.contains(target)) return;
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    open.value = false;
  }
}

watch(open, (value) => {
  const action = value ? "addEventListener" : "removeEventListener";
  document[action]("mousedown", onPointerDown);
  document[action]("touchstart", onPointerDown);
  window[action]("keydown", onKeydown);
  window[action]("resize", place);
  window[action]("scroll", place, true);
  if (value) nextTick(place);
});

watch(() => props.disabled, (disabled) => {
  if (disabled) open.value = false;
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onPointerDown);
  document.removeEventListener("touchstart", onPointerDown);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
});
</script>

<template>
  <div ref="root" class="form-select" :class="{ open, disabled }">
    <button
      type="button"
      class="form-select-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span :class="{ placeholder: !current }">{{ current?.label || placeholder }}</span>
      <ChevronDown :size="16" class="form-select-caret" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="layer" class="form-select-layer" @click.self="open = false">
        <div ref="panel" class="form-select-panel" :style="panelStyle" role="listbox" :aria-label="ariaLabel">
          <span class="sheet-grabber" aria-hidden="true"></span>
          <p v-if="!options.length" class="form-select-empty">暂无可选项</p>
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="form-select-option"
            :class="{ selected: option.value === modelValue }"
            :disabled="option.disabled"
            role="option"
            :aria-selected="option.value === modelValue"
            @click="pick(option)"
          >
            <span>{{ option.label }}</span>
            <Check :size="16" class="form-select-check" :class="{ inactive: option.value !== modelValue }" />
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
