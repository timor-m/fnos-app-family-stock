import { defineEventHandler, getRouterParam, readBody } from "h3";
import { updateIntakeDraft } from "../../../services/intake.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  return ok(updateIntakeDraft(getRequestUser(event), getRouterParam(event, "intakeId") || "", body || {}));
});
