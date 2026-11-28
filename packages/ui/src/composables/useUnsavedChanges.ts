import { onMounted, onScopeDispose, ref, type Ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useConfirm } from "./useConfirm";

export function useUnsavedChanges(snapshot: () => unknown, busy: Ref<boolean>) {
  const baseline = ref<string>();
  const { askConfirm } = useConfirm();
  const dirty = () => baseline.value !== undefined && JSON.stringify(snapshot()) !== baseline.value;
  function markSaved() { baseline.value = JSON.stringify(snapshot()); }
  async function canLeave() {
    if (busy.value) return false;
    return !dirty() || await askConfirm({ title: "放弃未保存的修改？", message: "离开后将丢失本次修改。", confirmText: "放弃修改", danger: true });
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (!dirty() && !busy.value) return;
    event.preventDefault(); event.returnValue = "";
  }
  onBeforeRouteLeave(canLeave);
  onBeforeRouteUpdate(canLeave);
  onMounted(() => window.addEventListener("beforeunload", beforeUnload));
  onScopeDispose(() => window.removeEventListener("beforeunload", beforeUnload));
  return { markSaved, canLeave };
}
