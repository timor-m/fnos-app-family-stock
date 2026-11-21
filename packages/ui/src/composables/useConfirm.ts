import { readonly, ref } from "vue";

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
};

type ConfirmState = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

const confirmState = ref<ConfirmState | null>(null);

export function useConfirm() {
  function askConfirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      confirmState.value = { ...options, resolve };
    });
  }

  function resolveConfirm(value: boolean) {
    confirmState.value?.resolve(value);
    confirmState.value = null;
  }

  return {
    confirmState: readonly(confirmState),
    askConfirm,
    resolveConfirm
  };
}
