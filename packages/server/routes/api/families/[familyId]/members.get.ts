import { defineEventHandler, getRouterParam } from "h3";
import { listFamilyMembers } from "../../../../services/catalog.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler((event) => {
  const familyId = getRouterParam(event, "familyId");
  return ok(listFamilyMembers(getRequestUser(event), familyId || ""));
});
