import { defineEventHandler, getRouterParam } from "h3";
import { deleteStoragePlace } from "../../../services/catalog.service";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler((event) => {
  const storagePlaceId = getRouterParam(event, "storagePlaceId");
  return ok(deleteStoragePlace(getRequestUser(event), storagePlaceId || ""));
});
