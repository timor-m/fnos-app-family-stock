export function formatQuantity(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export function formatDate(value: string | null) {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(`${value}T00:00:00`));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")));
}

export function formatLongDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(value);
}

export function expiryLabel(days: number | null) {
  if (days === null) return "未设置";
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天到期";
  return `${days} 天后`;
}

export function expiryClass(days: number | null) {
  if (days === null) return "neutral";
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  return "notice";
}
