import { defineEventHandler } from "h3";
import { ocrRuntimeInstaller } from "../../../services/ocr-runtime-installer.service";
import { requireAppAdmin } from "../../../utils/access-control";
import { ok } from "../../../utils/api-response";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  requireAppAdmin(getRequestUser(event));
  const installer = await ocrRuntimeInstaller.start();
  return ok({ installer });
});
