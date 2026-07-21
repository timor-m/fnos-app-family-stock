import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createIntakeDraft } from "../../services/intake.service";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  const result = createIntakeDraft(getRequestUser(event), body || {});
  setResponseStatus(event, 201);
  return ok(result);
});
