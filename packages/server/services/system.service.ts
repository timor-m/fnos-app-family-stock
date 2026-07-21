import { arch, platform } from "node:os";
import { getDatabaseStatus } from "../database/client";
import { getAppConfig } from "../utils/runtime-config";
import { getPublicAiSettings } from "./ai-settings.service";

export function getSystemSummary() {
  const config = getAppConfig();

  const aiSettings = getPublicAiSettings();
  return {
    appName: config.appName,
    appTitle: config.appTitle,
    accessMode: config.accessMode,
    gatewayPrefix: config.gatewayPrefix,
    appPort: config.appPort,
    runtime: "nitro",
    nodePlatform: platform(),
    nodeArch: arch(),
    processUptimeSec: Math.floor(process.uptime()),
    database: getDatabaseStatus(),
    ai: {
      enabled: aiSettings.enabled,
      provider: aiSettings.provider,
      configured: aiSettings.apiKeyConfigured,
      model: aiSettings.model
    }
  };
}
