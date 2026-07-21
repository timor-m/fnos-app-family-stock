import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from "h3";
import { addFamilyMember } from "../../../../services/catalog.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const familyId = getRouterParam(event, "familyId");
  const body = await readBody<Record<string, unknown>>(event);
  const result = addFamilyMember(getRequestUser(event), familyId || "", body || {});
  setResponseStatus(event, 201);
  return ok(result);
});
