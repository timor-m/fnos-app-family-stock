import { readonly, ref } from "vue";

export type ToastType = "success" | "error" | "dark";

export type ToastActionOptions = {
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  durationMs?: number;
};

type ToastState = {
  text: string;
  type: ToastType;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
};

const toast = ref<ToastState | null>(null);
let toastTimer: number | null = null;

export function useToast() {
  function clearToast() {
    if (toastTimer) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.value = null;
  }

  function showToast(message: string, type: ToastType = "success", options?: ToastActionOptions) {
    toast.value = {
      text: message,
      type,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction
    };
    if (toastTimer) window.clearTimeout(toastTimer);
    const duration = options?.durationMs ?? (options?.actionLabel ? 5000 : 2800);
    toastTimer = window.setTimeout(() => {
      toast.value = null;
      toastTimer = null;
    }, duration);
  }

  async function triggerToastAction() {
    const action = toast.value?.onAction;
    clearToast();
    if (action) {
      await action();
    }
  }

  return {
    toast: readonly(toast),
    showToast,
    clearToast,
    triggerToastAction
  };
}
