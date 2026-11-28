import { defineEventHandler, readBody } from "h3";
import { listAiModels } from "../../../services/ai-settings.service";
import { ok } from "../../../utils/api-response";
import { requireAppAdmin } from "../../../utils/access-control";
import { getRequestUser } from "../../../utils/request-user";
export default defineEventHandler(async event => {
  requireAppAdmin(getRequestUser(event));
  return ok(await listAiModels(await readBody<Record<string, unknown>>(event) || {}));
});
