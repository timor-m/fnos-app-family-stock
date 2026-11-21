import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPushPayload,
  computeSchedulePeriodKey,
  maskWebhookUrl,
  type PushDigest
} from "./push-notification.helpers.ts";

const sampleDigest: PushDigest = {
  generatedAt: "2026-11-20T01:00:00.000Z",
  expiringDays: 14,
  expiredCount: 1,
  expiringCount: 1,
  lowStockCount: 1,
  totalCount: 3,
  title: "家藏提醒：1 已过期 / 1 临期 / 1 低库存",
  markdown: "### 家藏提醒\n- 布洛芬已过期 2 天",
  text: "家藏提醒\n- 布洛芬已过期 2 天",
  expired: [],
  expiring: [],
  lowStock: []
};

test("maskWebhookUrl hides path suffix", () => {
  const masked = maskWebhookUrl("https://notify.local/channel/demo-path-123456");
  assert.ok(masked.startsWith("https://notify.local/"));
  assert.ok(masked.includes("****"));
  assert.ok(!masked.includes("demo-path-1234"));
});

test("buildPushPayload formats channel-specific payloads", () => {
  const wecom = buildPushPayload("wecom", sampleDigest) as { msgtype: string; markdown: { content: string } };
  assert.equal(wecom.msgtype, "markdown");
  assert.equal(wecom.markdown.content, sampleDigest.markdown);

  const feishu = buildPushPayload("feishu", sampleDigest) as { msg_type: string; content: { text: string } };
  assert.equal(feishu.msg_type, "text");
  assert.equal(feishu.content.text, sampleDigest.text);

  const dingtalk = buildPushPayload("dingtalk", sampleDigest) as { msgtype: string; markdown: { title: string } };
  assert.equal(dingtalk.msgtype, "markdown");
  assert.equal(dingtalk.markdown.title, sampleDigest.title);

  const bark = buildPushPayload("bark", sampleDigest) as { title: string; body: string; group: string };
  assert.equal(bark.title, sampleDigest.title);
  assert.equal(bark.group, "家藏");

  const generic = buildPushPayload("webhook", sampleDigest) as { app: string; summary: { expiringCount: number } };
  assert.equal(generic.app, "fnos-app-family-stock");
  assert.equal(generic.summary.expiringCount, 1);
});

test("computeSchedulePeriodKey respects schedule, weekday and hour", () => {
  const mondayMorning = new Date(2026, 10, 16, 9, 5, 0);
  assert.equal(computeSchedulePeriodKey(mondayMorning, "weekly", 1, 9), "weekly:2026-11-16");
  assert.equal(computeSchedulePeriodKey(mondayMorning, "weekly", 2, 9), null);
  assert.equal(computeSchedulePeriodKey(mondayMorning, "weekly", 1, 10), null);
  assert.equal(computeSchedulePeriodKey(mondayMorning, "daily", 0, 9), "daily:2026-11-16");
});
