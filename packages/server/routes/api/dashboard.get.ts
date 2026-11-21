import { defineEventHandler, getQuery } from "h3";
import { getDashboard } from "../../services/dashboard.service";
import { ok } from "../../utils/api-response";
import { getRequestUser } from "../../utils/request-user";

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const familyId = typeof query.familyId === "string" ? query.familyId : "default-family";
  const locationId = typeof query.locationId === "string" && query.locationId ? query.locationId : undefined;
  const storagePlaceId =
    typeof query.storagePlaceId === "string" && query.storagePlaceId ? query.storagePlaceId : undefined;
  const inventoryLimit = Number(query.inventoryLimit || 20);
  const inventoryOffset = Number(query.inventoryOffset || 0);
  const search = typeof query.search === "string" ? query.search : "";
  const stock = query.stock === "low" ? "low" : undefined;

  return ok(getDashboard(getRequestUser(event), familyId, locationId, {
    inventoryLimit,
    inventoryOffset,
    search,
    storagePlaceId,
    stock
  }));
});
