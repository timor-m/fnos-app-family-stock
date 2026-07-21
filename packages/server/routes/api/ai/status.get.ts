import { defineEventHandler } from "h3";
import { aiJobRunner } from "../../../services/ai-job-runner.service";
import { getPublicAiSettings } from "../../../services/ai-settings.service";
import { ok } from "../../../utils/api-response";

export default defineEventHandler(() => ok({
  settings: getPublicAiSettings(),
  queue: aiJobRunner.getStatus()
}));
