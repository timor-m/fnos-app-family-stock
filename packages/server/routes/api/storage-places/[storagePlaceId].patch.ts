import { defineEventHandler, getRouterParam, readBody } from "h3";
import { renameStoragePlace } from "../../../services/catalog.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const storagePlaceId = getRouterParam(event, "storagePlaceId");
  const body = await readBody<Record<string, unknown>>(event);
  return ok(renameStoragePlace(getRequestUser(event), storagePlaceId || "", body?.name));
});
