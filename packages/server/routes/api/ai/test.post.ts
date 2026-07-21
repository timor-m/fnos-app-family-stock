import { defineEventHandler, readBody } from "h3";
import { testAiConnection } from "../../../services/ai-settings.service";
import { ok } from "../../../utils/api-response";
import { requireAppAdmin } from "../../../utils/access-control";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  requireAppAdmin(getRequestUser(event));
  const body = await readBody<Record<string, unknown>>(event);
  return ok(await testAiConnection(body || {}));
});
