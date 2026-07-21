import { createReadStream } from "node:fs";
import {
  defineEventHandler,
  getQuery,
  getRouterParam,
  sendStream,
  setResponseHeader
} from "h3";
import { getMediaAsset } from "../../../services/intake.service";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const variant = typeof query.variant === "string" ? query.variant : undefined;
  const asset = await getMediaAsset(getRequestUser(event), getRouterParam(event, "mediaId") || "", { variant });
  setResponseHeader(event, "content-type", asset.mimeType);
  setResponseHeader(event, "cache-control", "private, max-age=3600");
  setResponseHeader(event, "x-content-type-options", "nosniff");
  return sendStream(event, createReadStream(asset.filePath));
});
