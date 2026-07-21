import { defineEventHandler, getRouterParam } from "h3";
import { removeFamilyMember } from "../../../../../services/catalog.service";
import { ok } from "../../../../../utils/api-response";
import { getRequestUser } from "../../../../../utils/request-user";

export default defineEventHandler((event) => {
  const familyId = getRouterParam(event, "familyId");
  const userId = getRouterParam(event, "userId");
  return ok(removeFamilyMember(getRequestUser(event), familyId || "", userId || ""));
});
