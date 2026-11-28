import { defineEventHandler, readBody } from "h3";
import { enqueueEligibleAiDrafts } from "../../../services/ai-job-runner.service";
import { updateAiSettings } from "../../../services/ai-settings.service";
import { ok } from "../../../utils/api-response";
import { requireAppAdmin } from "../../../utils/access-control";
import { getRequestUser } from "../../../utils/request-user";

export default defineEventHandler(async (event) => {
  requireAppAdmin(getRequestUser(event));
  const body = await readBody<Record<string, unknown>>(event);
  const settings = updateAiSettings(body || {});
  const enqueuedDrafts = settings.enabled && settings.configured ? enqueueEligibleAiDrafts() : 0;
  return ok({ ...settings, enqueuedDrafts });
});
