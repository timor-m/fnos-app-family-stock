import { defineEventHandler, getRouterParam, readBody } from "h3";
import { renameLocation } from "../../../services/catalog.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const locationId = getRouterParam(event, "locationId");
  const body = await readBody<Record<string, unknown>>(event);
  return ok(renameLocation(getRequestUser(event), locationId || "", body?.name));
});
