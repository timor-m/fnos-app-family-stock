import { defineEventHandler } from "h3";
import { ocrJobRunner } from "../../../services/ocr-job-runner.service";
import { ocrProcessManager } from "../../../services/ocr-process.service";
import { ocrRuntimeInstaller } from "../../../services/ocr-runtime-installer.service";
import { ok } from "../../../utils/api-response";

export default defineEventHandler(async () => {
  await ocrProcessManager.checkRuntime();
  return ok({
    ...ocrJobRunner.getStatus(),
    installer: ocrRuntimeInstaller.getStatus()
  });
});
