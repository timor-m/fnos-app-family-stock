import { defineEventHandler, getRouterParam, setResponseStatus } from "h3";
import { retryIntake } from "../../../../services/intake.service";
import { ocrProcessManager } from "../../../../services/ocr-process.service";
import { ok } from "../../../../utils/api-response";
import { getRequestUser } from "../../../../utils/request-user";

export default defineEventHandler(async (event) => {
  const intakeId = getRouterParam(event, "intakeId") || "";
  await ocrProcessManager.checkRuntime(true);
  const result = retryIntake(getRequestUser(event), intakeId);
  setResponseStatus(event, 202);
  return ok(result);
});
