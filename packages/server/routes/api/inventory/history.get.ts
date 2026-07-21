import { createError, defineEventHandler, getQuery } from "h3";
import { getInventoryHistory } from "../../../services/inventory.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const familyId = typeof query.familyId === "string" ? query.familyId : "";
  const locationId = typeof query.locationId === "string" && query.locationId ? query.locationId : undefined;

  if (!familyId) {
    throw createError({ statusCode: 400, statusMessage: "familyId 不能为空" });
  }

  return ok(getInventoryHistory(getRequestUser(event), familyId, locationId));
});
