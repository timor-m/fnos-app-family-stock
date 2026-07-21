import { defineEventHandler, getRouterParam } from "h3";
import { deleteLocation } from "../../../services/catalog.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler((event) => {
  const locationId = getRouterParam(event, "locationId");
  return ok(deleteLocation(getRequestUser(event), locationId || ""));
});
