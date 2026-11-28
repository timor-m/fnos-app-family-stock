<script setup lang="ts">
import { ref, toRef, useId } from "vue";
import { useOverlay } from "../../composables/useOverlay";
import { X } from "@lucide/vue";

const props = withDefaults(defineProps<{
  open: boolean;
  busy?: boolean;
  title: string;
  description?: string;
  titleId?: string;
  compact?: boolean;
  panelClass?: string;
}>(), {
  description: "",
  titleId: "",
  compact: false,
  panelClass: ""
});

const emit = defineEmits<{
  close: [];
}>();

const panel = ref<HTMLElement | null>(null);
const generatedId = useId();
function close() { if (!props.busy) emit("close"); }
useOverlay(toRef(props, "open"), panel, close);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @click.self="close">
      <section ref="panel" tabindex="-1" :aria-busy="busy || undefined"
        class="modal"
        :class="[compact ? 'compact-modal' : '', panelClass]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId || generatedId"
      >
        <span class="sheet-grabber" aria-hidden="true"></span>
        <header class="modal-header">
          <div>
            <h2 :id="titleId || generatedId">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" :disabled="busy" @click="close">
            <X :size="20" />
          </button>
        </header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
