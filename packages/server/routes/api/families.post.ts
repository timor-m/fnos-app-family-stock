import { defineEventHandler, readBody, setResponseStatus } from "h3";
import { createFamily } from "../../services/catalog.service";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  const result = createFamily(getRequestUser(event), body?.name);
  setResponseStatus(event, 201);
  return ok(result);
});
