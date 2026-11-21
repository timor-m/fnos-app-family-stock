import { defineEventHandler } from "h3";
import { sendPushDigestNow } from "../../../../services/push-notification.service";
import { requireAppAdmin } from "../../../../utils/access-control";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  requireAppAdmin(getRequestUser(event));
  return ok(await sendPushDigestNow({ scheduled: false }));
});
