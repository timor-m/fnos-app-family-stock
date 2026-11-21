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

export function computeQuickExpiryDate(baseDate: string | null | undefined, addMonths: number) {
  const base =
    baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)
      ? new Date(`${baseDate}T00:00:00`)
      : new Date();
  const year = base.getFullYear();
  const month = base.getMonth();
  const day = base.getDate();
  const targetMonthIndex = month + addMonths;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const maxDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const clampedDay = Math.min(day, maxDay);
  const yyyy = String(targetYear);
  const mm = String(normalizedMonth + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
