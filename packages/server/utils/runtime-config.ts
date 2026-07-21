import templateConfig from "../../../template.config.json" with { type: "json" };
import { resolve } from "node:path";

export type AppRuntimeConfig = {
  appName: string;
  appTitle: string;
  accessMode: "gateway" | "port";
  gatewayPrefix: string;
  appPort: number | null;
  logLevel: string;
  logDir: string;
  storageDir: string;
  ocrPythonBin: string;
  ocrWorkerScript: string;
  ocrSetupScript: string;
  ocrPollIntervalMs: number;
  aiEnabled: boolean;
  aiProvider: string;
  aiApiBase: string;
  aiApiKey: string;
  aiModel: string;
  deepseekApiBase: string;
  deepseekApiKey: string;
  deepseekModel: string;
  aiTimeoutSeconds: number;
  aiMaxRetries: number;
};

export function getAppConfig(): AppRuntimeConfig {
  const appName = process.env.APP_NAME || templateConfig.appName;
  const isDevelopment = process.env.NODE_ENV === "development" || Boolean(process.env.VITE_DEV_SERVER_URL);
  const developmentDataDir = resolve(process.cwd(), ".data");
  const productionAppDir = process.env.TRIM_APPDEST || process.env.APP_DEST || process.cwd();
  const productionDataDir = process.env.TRIM_PKGVAR ? resolve(process.env.TRIM_PKGVAR, "data") : `/var/apps/${appName}/var/data`;
  const defaultWorkerScript = isDevelopment
    ? resolve(process.cwd(), "packages", "ocr-worker", "worker.py")
    : resolve(productionAppDir, "ocr-worker", "worker.py");
  const defaultSetupScript = isDevelopment
    ? resolve(process.cwd(), "packages", "ocr-worker", "setup-runtime.sh")
    : resolve(productionAppDir, "ocr-worker", "setup-runtime.sh");

  return {
    appName,
    appTitle: process.env.APP_TITLE || templateConfig.appTitle,
    accessMode: process.env.FNOS_SOCKET_PATH ? "gateway" : "port",
    gatewayPrefix: process.env.GATEWAY_PREFIX || templateConfig.gatewayPrefix,
    appPort: process.env.FNOS_SOCKET_PATH
      ? null
      : Number(process.env.NITRO_PORT || process.env.PORT || templateConfig.localDevPort),
    logLevel: process.env.LOG_LEVEL || templateConfig.logLevel,
    logDir: process.env.LOG_DIR || (isDevelopment ? resolve(developmentDataDir, "logs") : `/var/apps/${appName}/var/log`),
    storageDir: process.env.STORAGE_DIR || (isDevelopment ? developmentDataDir : productionDataDir),
    ocrPythonBin:
      process.env.OCR_PYTHON_BIN ||
      (isDevelopment
        ? resolve(developmentDataDir, "ocr-venv", "bin", "python")
        : resolve(productionDataDir, "ocr-venv", "bin", "python")),
    ocrWorkerScript: process.env.OCR_WORKER_SCRIPT || defaultWorkerScript,
    ocrSetupScript: process.env.OCR_SETUP_SCRIPT || defaultSetupScript,
    ocrPollIntervalMs: Math.max(500, Number(process.env.OCR_POLL_INTERVAL_MS || 1500)),
    aiEnabled: process.env.AI_ENABLED === "true",
    aiProvider: process.env.AI_PROVIDER || "deepseek",
    aiApiBase: process.env.AI_API_BASE || "",
    aiApiKey: process.env.AI_API_KEY || "",
    aiModel: process.env.AI_MODEL || "",
    deepseekApiBase: process.env.DEEPSEEK_API_BASE || "https://api.deepseek.com",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    aiTimeoutSeconds: Math.min(120, Math.max(5, Number(process.env.AI_TIMEOUT_SECONDS || 30))),
    aiMaxRetries: Math.min(3, Math.max(0, Number(process.env.AI_MAX_RETRIES || 1)))
  };
}
