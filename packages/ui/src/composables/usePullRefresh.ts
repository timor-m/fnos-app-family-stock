import { computed, readonly, ref } from "vue";

type PullRefreshOptions = {
  canStart?: () => boolean;
  refresh: () => Promise<void>;
  threshold?: number;
  maxDistance?: number;
  ignoreSelector?: string;
};

const defaultIgnoreSelector = "button, input, select, textarea, a, .topbar, .mobile-nav, .modal-backdrop, [role='dialog']";

function isPageAtTop() {
  return window.scrollY <= 2 && document.documentElement.scrollTop <= 2 && document.body.scrollTop <= 2;
}

export function usePullRefresh(options: PullRefreshOptions) {
  const pullRefreshing = ref(false);
  const pullDistance = ref(0);
  const pullThreshold = options.threshold || 52;
  const maxDistance = options.maxDistance || 96;
  let pullStartY = 0;
  let pullTracking = false;

  const pullRefreshVisible = computed(() => pullDistance.value > 0 || pullRefreshing.value);
  const pullRefreshReady = computed(() => pullDistance.value >= pullThreshold);
  const pullRefreshLabel = computed(() => {
    if (pullRefreshing.value) return "正在刷新";
    return pullRefreshReady.value ? "松手刷新" : "下拉刷新";
  });

  function isInteractivePullTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(options.ignoreSelector || defaultIgnoreSelector));
  }

  function onPullTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1 || pullRefreshing.value) return;
    if (options.canStart && !options.canStart()) return;
    if (isInteractivePullTarget(event.target)) return;
    if (!isPageAtTop()) return;
    pullTracking = true;
    pullStartY = event.touches[0].clientY;
    pullDistance.value = 0;
  }

  function onPullTouchMove(event: TouchEvent) {
    if (!pullTracking || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - pullStartY;
    if (delta <= 0 || !isPageAtTop()) {
      pullDistance.value = 0;
      return;
    }
    event.preventDefault();
    pullDistance.value = Math.min(maxDistance, delta * 0.55);
  }

  function onPullTouchCancel() {
    pullTracking = false;
    if (!pullRefreshing.value) {
      pullDistance.value = 0;
    }
  }

  async function onPullTouchEnd() {
    if (!pullTracking) return;
    pullTracking = false;
    const shouldRefresh = pullDistance.value >= pullThreshold;
    if (!shouldRefresh) {
      pullDistance.value = 0;
      return;
    }

    pullRefreshing.value = true;
    pullDistance.value = Math.min(76, maxDistance);
    try {
      await options.refresh();
    } finally {
      pullRefreshing.value = false;
      pullDistance.value = 0;
    }
  }

  return {
    pullRefreshing: readonly(pullRefreshing),
    pullDistance: readonly(pullDistance),
    pullRefreshVisible,
    pullRefreshReady,
    pullRefreshLabel,
    onPullTouchStart,
    onPullTouchMove,
    onPullTouchEnd,
    onPullTouchCancel
  };
}
