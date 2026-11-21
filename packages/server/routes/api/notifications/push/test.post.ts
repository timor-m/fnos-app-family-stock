import { defineEventHandler, readBody } from "h3";
import { testPushNotification } from "../../../../services/push-notification.service";
import { requireAppAdmin } from "../../../../utils/access-control";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  requireAppAdmin(getRequestUser(event));
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}));
  return ok(await testPushNotification(body || {}));
});
