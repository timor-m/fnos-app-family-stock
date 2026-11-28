import { nextTick, onMounted, onScopeDispose, watch, type Ref } from "vue";

const stack: symbol[] = [];
let locks = 0;
let previousOverflow = "";

export function useOverlay(open: Readonly<Ref<boolean>>, panel: Ref<HTMLElement | null>, close: () => void) {
  const token = Symbol("overlay");
  let returnFocus: HTMLElement | null = null;
  let held = false;
  function release() {
    if (!held) return;
    held = false;
    const top = stack.at(-1) === token;
    stack.splice(stack.indexOf(token), 1);
    if (--locks === 0) document.body.style.overflow = previousOverflow;
    if (top && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  watch(open, async visible => {
    if (!visible) { release(); return; }
    if (held) return;
    held = true;
    stack.push(token);
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (locks++ === 0) previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await nextTick();
    if (open.value && stack.at(-1) === token) panel.value?.focus({ preventScroll: true });
  }, { immediate: true, flush: "sync" });
  function onKeydown(event: KeyboardEvent) {
    if (!open.value || stack.at(-1) !== token || !panel.value) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); close(); return;
    }
    if (event.key !== "Tab") return;
    const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
      .filter(el => !el.closest('[hidden], [inert]') && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
    const first = controls[0], last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); panel.value.focus(); return; }
    const inside = controls.includes(document.activeElement as HTMLElement);
    if (event.shiftKey && (!inside || document.activeElement === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (!inside || document.activeElement === last)) { event.preventDefault(); first.focus(); }
  }
  onMounted(() => window.addEventListener("keydown", onKeydown, true));
  onScopeDispose(() => { window.removeEventListener("keydown", onKeydown, true); release(); });
}
