<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "@lucide/vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  placeholder?: string;
  ariaLabel?: string;
  clearable?: boolean;
}>(), {
  placeholder: "选择日期",
  ariaLabel: "日期",
  clearable: true
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const layer = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});
const view = ref({ year: new Date().getFullYear(), month: new Date().getMonth() });
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

const selected = computed(() => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(props.modelValue);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
});

const label = computed(() => {
  if (!selected.value) return props.placeholder;
  const month = String(selected.value.month + 1).padStart(2, "0");
  const day = String(selected.value.day).padStart(2, "0");
  return `${selected.value.year}/${month}/${day}`;
});

const monthTitle = computed(() => `${view.value.year}年${view.value.month + 1}月`);

const cells = computed(() => {
  const firstWeekday = (new Date(view.value.year, view.value.month, 1).getDay() + 6) % 7;
  const days = new Date(view.value.year, view.value.month + 1, 0).getDate();
  const items: Array<{ key: string; day: number; date: string }> = [];
  for (let index = 0; index < firstWeekday; index += 1) items.push({ key: `pad-${index}`, day: 0, date: "" });
  for (let day = 1; day <= days; day += 1) {
    const month = String(view.value.month + 1).padStart(2, "0");
    const date = `${view.value.year}-${month}-${String(day).padStart(2, "0")}`;
    items.push({ key: date, day, date });
  }
  return items;
});

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function revealTrigger() {
  if (window.matchMedia("(max-width: 760px)").matches) return;
  const trigger = root.value;
  const modal = trigger?.closest(".modal");
  if (!trigger || !(modal instanceof HTMLElement)) return;
  const triggerRect = trigger.getBoundingClientRect();
  const modalRect = modal.getBoundingClientRect();
  modal.scrollTop += triggerRect.top - (modalRect.top + 64);
}

function place() {
  if (!open.value) return;
  if (window.matchMedia("(max-width: 760px)").matches) {
    panelStyle.value = {};
    return;
  }
  const rect = root.value?.getBoundingClientRect();
  if (!rect) return;
  const width = 312;
  const footer = root.value?.closest(".modal")?.querySelector(".modal-footer");
  const footerTop = footer instanceof HTMLElement ? footer.getBoundingClientRect().top : window.innerHeight;
  const spaceBelow = Math.min(window.innerHeight, footerTop) - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openAbove = spaceBelow < 280 && spaceAbove > spaceBelow;
  const available = Math.max(180, Math.min(360, openAbove ? spaceAbove : spaceBelow));
  panelStyle.value = {
    position: "fixed",
    left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
    width: `${width}px`,
    maxHeight: `${available}px`,
    overflow: "auto",
    ...(openAbove
      ? { bottom: `${window.innerHeight - rect.top + 8}px` }
      : { top: `${rect.bottom + 8}px` })
  };
}

function openPanel() {
  const base = selected.value || { year: new Date().getFullYear(), month: new Date().getMonth() };
  view.value = { year: base.year, month: base.month };
  revealTrigger();
  open.value = true;
}

function shift(delta: number) {
  const next = new Date(view.value.year, view.value.month + delta, 1);
  view.value = { year: next.getFullYear(), month: next.getMonth() };
}

function pick(date: string) {
  emit("update:modelValue", date);
  open.value = false;
}

function onPointerDown(event: Event) {
  const target = event.target as Node;
  if (root.value?.contains(target) || layer.value?.contains(target)) return;
  open.value = false;
}

watch(open, (value) => {
  const action = value ? "addEventListener" : "removeEventListener";
  document[action]("mousedown", onPointerDown);
  document[action]("touchstart", onPointerDown);
  window[action]("resize", place);
  window[action]("scroll", place, true);
  if (value) nextTick(() => {
    revealTrigger();
    place();
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onPointerDown);
  document.removeEventListener("touchstart", onPointerDown);
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
});
</script>

<template>
  <div ref="root" class="date-field" :class="{ open }">
    <button type="button" class="date-field-trigger" :aria-label="ariaLabel" :aria-expanded="open" aria-haspopup="dialog" @click="openPanel">
      <span :class="{ placeholder: !modelValue }">{{ label }}</span>
      <CalendarDays :size="16" />
    </button>
    <button v-if="clearable && modelValue" type="button" class="date-field-clear" aria-label="清除日期" @click="emit('update:modelValue', '')">
      <X :size="14" />
    </button>
    <Teleport to="body">
      <div v-if="open" ref="layer" class="date-field-layer" @click.self="open = false">
        <div ref="panel" class="date-field-panel" :style="panelStyle" role="dialog" :aria-label="ariaLabel">
          <span class="sheet-grabber" aria-hidden="true"></span>
          <header>
            <button type="button" aria-label="上个月" @click="shift(-1)"><ChevronLeft :size="16" /></button>
            <strong>{{ monthTitle }}</strong>
            <button type="button" aria-label="下个月" @click="shift(1)"><ChevronRight :size="16" /></button>
          </header>
          <div class="date-weekdays"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
          <div class="date-grid">
            <button
              v-for="cell in cells"
              :key="cell.key"
              type="button"
              :disabled="!cell.day"
              :class="{ selected: cell.date === modelValue, today: cell.date === todayKey() }"
              @click="cell.date && pick(cell.date)"
            >
              {{ cell.day || "" }}
            </button>
          </div>
          <footer>
            <button type="button" @click="pick(todayKey())">今天</button>
            <button v-if="clearable" type="button" @click="pick('')">清除</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>
