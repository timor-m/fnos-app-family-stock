import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import WorkspacePage from "./pages/WorkspacePage.vue";

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const workspaceRoutes: RouteRecordRaw[] = [
  { path: "/overview", component: WorkspacePage, meta: { view: "overview", title: "库存概览" } },
  { path: "/inventory", component: WorkspacePage, meta: { view: "inventory", title: "全部库存" } },
  { path: "/history", component: WorkspacePage, meta: { view: "history", title: "历史物品" } },
  { path: "/expiry", component: WorkspacePage, meta: { view: "expiry", title: "临期管理" } },
  { path: "/intakes", component: WorkspacePage, meta: { view: "intakes", title: "拍照录入任务" } },
  { path: "/me", component: WorkspacePage, meta: { view: "locations", title: "我的" } },
  { path: "/me/families", component: WorkspacePage, meta: { view: "locations", profileSection: "family", title: "家庭分组" } },
  { path: "/me/locations", component: WorkspacePage, meta: { view: "locations", profileSection: "locations", title: "房屋地点" } },
  { path: "/me/ai", component: WorkspacePage, meta: { view: "locations", profileSection: "ai", title: "AI 设置" } },
  { path: "/me/push", component: WorkspacePage, meta: { view: "locations", profileSection: "push", title: "外部推送提醒" } },
  { path: "/me/runtime", component: WorkspacePage, meta: { view: "locations", profileSection: "runtime", title: "运行状态" } },
  { path: "/me/about", component: WorkspacePage, meta: { view: "locations", title: "关于" } }
];

const router = createRouter({
  history: createWebHistory(base),
  routes: [
    { path: "/", redirect: "/overview" },
    ...workspaceRoutes,
    { path: "/:pathMatch(.*)*", redirect: "/overview" }
  ]
});

export default router;
