import { defineEventHandler } from "h3";
import { getPublicAiSettings } from "../../../services/ai-settings.service";
import { ok } from "../../../utils/api-response";

export default defineEventHandler(() => ok(getPublicAiSettings()));
