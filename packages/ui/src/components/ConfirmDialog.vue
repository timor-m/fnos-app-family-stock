<script setup lang="ts">
import { ref as overlayRef, toRef } from "vue";
import { useOverlay } from "../composables/useOverlay";
import { TriangleAlert, X } from "@lucide/vue";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}>(), {
  confirmText: "确认",
  danger: false
});

const emit = defineEmits<{ confirm: []; cancel: [] }>();
const overlayPanel = overlayRef<HTMLElement | null>(null);
useOverlay(toRef(props, "open"), overlayPanel, () => emit("cancel"));
</script>

<template>
  <Teleport to="body">
  <div v-if="open" class="confirm-backdrop" @click.self="emit('cancel')">
    <section ref="overlayPanel" tabindex="-1" class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <header>
        <div class="confirm-icon"><TriangleAlert :size="20" /></div>
        <div><h2 id="confirm-title">{{ title }}</h2><p>{{ message }}</p></div>
        <button type="button" aria-label="关闭" @click="emit('cancel')"><X :size="19" /></button>
      </header>
      <footer>
        <button class="cancel" type="button" @click="emit('cancel')">取消</button>
        <button :class="['confirm', { danger }]" type="button" @click="emit('confirm')">{{ confirmText }}</button>
      </footer>
    </section>
  </div>
  </Teleport>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(28, 32, 28, 0.45);
  padding: 20px;
}
.confirm-dialog {
  width: min(420px, 100%);
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}
header {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 34px;
  gap: 12px;
  padding: 20px;
}
.confirm-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 7px;
  background: var(--amber-soft);
  color: var(--amber);
}
h2, p { margin: 0; }
h2 { font-size: 16px; }
p { margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.6; }
header > button {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--muted);
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  border-top: 1px solid var(--line);
  padding: 13px 20px;
}
footer button {
  min-height: 38px;
  border-radius: 6px;
  padding: 0 16px;
  font-weight: 700;
}
.cancel { border: 1px solid var(--line); background: var(--surface); color: var(--text); }
.confirm { border: 1px solid var(--green); background: var(--green); color: white; }
.confirm.danger { border-color: var(--red); background: var(--red); }
</style>
