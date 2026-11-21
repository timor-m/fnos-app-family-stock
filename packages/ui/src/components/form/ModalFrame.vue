<script setup lang="ts">
import { X } from "@lucide/vue";

withDefaults(defineProps<{
  open: boolean;
  title: string;
  description?: string;
  titleId?: string;
  compact?: boolean;
  panelClass?: string;
}>(), {
  description: "",
  titleId: "modal-title",
  compact: false,
  panelClass: ""
});

const emit = defineEmits<{
  close: [];
}>();

function trapTabKey(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const container = event.currentTarget as HTMLElement;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <section
      class="modal"
      :class="[compact ? 'compact-modal' : '', panelClass]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @keydown="trapTabKey"
    >
      <span class="sheet-grabber" aria-hidden="true"></span>
      <header class="modal-header">
        <div>
          <h2 :id="titleId">{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="20" />
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
