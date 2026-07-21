import { defineEventHandler, getRouterParam, readBody } from "h3";
import { renameFamily } from "../../../services/catalog.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const familyId = getRouterParam(event, "familyId");
  const body = await readBody<Record<string, unknown>>(event);
  return ok(renameFamily(getRequestUser(event), familyId || "", body?.name));
});
