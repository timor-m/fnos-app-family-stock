export type PushChannel = "wecom" | "feishu" | "dingtalk" | "bark" | "webhook";
export type PushSchedule = "weekly" | "daily";

export type DigestExpiringRow = {
  familyName: string;
  locationName: string;
  storagePlaceName: string | null;
  name: string;
  quantity: number;
  unit: string;
  expirationDate: string;
  daysRemaining: number;
};

export type DigestLowStockRow = {
  familyName: string;
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
};

export type PushDigest = {
  generatedAt: string;
  expiringDays: number;
  expiredCount: number;
  expiringCount: number;
  lowStockCount: number;
  totalCount: number;
  title: string;
  markdown: string;
  text: string;
  expired: DigestExpiringRow[];
  expiring: DigestExpiringRow[];
  lowStock: DigestLowStockRow[];
};

export function maskWebhookUrl(url: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const tail = `${parsed.pathname}${parsed.search}`;
    if (tail.length <= 12) return `${parsed.origin}/****`;
    return `${parsed.origin}${tail.slice(0, 8)}****${tail.slice(-4)}`;
  } catch {
    if (url.length <= 10) return "****";
    return `${url.slice(0, 6)}****${url.slice(-4)}`;
  }
}

export function buildPushPayload(channel: PushChannel, digest: PushDigest) {
  if (channel === "wecom") {
    return {
      msgtype: "markdown",
      markdown: {
        content: digest.markdown
      }
    };
  }
  if (channel === "feishu") {
    return {
      msg_type: "text",
      content: {
        text: digest.text
      }
    };
  }
  if (channel === "dingtalk") {
    return {
      msgtype: "markdown",
      markdown: {
        title: digest.title,
        text: digest.markdown
      }
    };
  }
  if (channel === "bark") {
    return {
      title: digest.title,
      body: digest.text,
      group: "家藏"
    };
  }
  return {
    app: "fnos-app-family-stock",
    title: digest.title,
    text: digest.text,
    markdown: digest.markdown,
    summary: {
      expiredCount: digest.expiredCount,
      expiringCount: digest.expiringCount,
      lowStockCount: digest.lowStockCount,
      expiringDays: digest.expiringDays
    },
    expired: digest.expired,
    expiring: digest.expiring,
    lowStock: digest.lowStock,
    generatedAt: digest.generatedAt
  };
}

export function computeSchedulePeriodKey(now: Date, schedule: PushSchedule, weekday: number, sendHour: number) {
  if (now.getHours() < sendHour) return null;
  if (schedule === "weekly" && now.getDay() !== weekday) return null;
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${schedule}:${y}-${m}-${d}`;
}
