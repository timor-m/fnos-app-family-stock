import { defineEventHandler } from "h3";
import { ok } from "../../utils/api-response";
import { getAppConfig } from "../../utils/runtime-config";
import { getPublicAiSettings } from "../../services/ai-settings.service";

export default defineEventHandler(() => {
  const config = getAppConfig();
  const aiSettings = getPublicAiSettings();

  return ok({
    appName: config.appName,
    appTitle: config.appTitle,
    accessMode: config.accessMode,
    gatewayPrefix: config.gatewayPrefix,
    appPort: config.appPort,
    logLevel: config.logLevel,
    aiEnabled: aiSettings.enabled,
    aiProvider: aiSettings.provider,
    aiConfigured: aiSettings.apiKeyConfigured,
    aiModel: aiSettings.model
  });
});
