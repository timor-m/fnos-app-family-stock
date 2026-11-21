import { defineEventHandler } from "h3";
import { getPushSettings } from "../../../../services/push-notification.service";
import { requireAppAdmin } from "../../../../utils/access-control";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler((event) => {
  requireAppAdmin(getRequestUser(event));
  return ok(getPushSettings());
});
