import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname } from "node:path";
import { getAppConfig } from "../utils/runtime-config";
import { writeLog } from "../utils/logger";
import { ocrProcessManager } from "./ocr-process.service";

type InstallerState = "idle" | "installing" | "succeeded" | "failed";

type InstallerStatus = {
  state: InstallerState;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  errorMessage: string | null;
  logTail: string[];
  setupScript: string;
  venvDir: string;
};

const maxLogLines = 80;

function getVenvDir(pythonBin: string) {
  return dirname(dirname(pythonBin));
}

class OcrRuntimeInstaller {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: Omit<InstallerStatus, "running" | "setupScript" | "venvDir"> = {
    state: "idle",
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    errorMessage: null,
    logTail: []
  };

  getStatus(): InstallerStatus {
    const config = getAppConfig();
    return {
      ...this.status,
      running: Boolean(this.child && !this.child.killed),
      setupScript: config.ocrSetupScript,
      venvDir: getVenvDir(config.ocrPythonBin)
    };
  }

  async start() {
    if (this.child && !this.child.killed) {
      return this.getStatus();
    }

    const runtime = await ocrProcessManager.checkRuntime(true);
    if (runtime.ready) {
      this.status = {
        state: "succeeded",
        startedAt: this.status.startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        errorMessage: null,
        logTail: ["OCR 运行环境已就绪，无需重复安装。"]
      };
      return this.getStatus();
    }

    const config = getAppConfig();
    this.status = {
      state: "installing",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      errorMessage: null,
      logTail: []
    };

    const child = spawn("/bin/sh", [config.ocrSetupScript], {
      env: {
        ...process.env,
        STORAGE_DIR: config.storageDir,
        OCR_VENV_DIR: getVenvDir(config.ocrPythonBin),
        PYTHON_BIN: process.env.PYTHON_BIN || "python3"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;

    const append = (chunk: Buffer | string) => {
      const text = String(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.status.logTail.push(line.slice(0, 500));
      }
      if (this.status.logTail.length > maxLogLines) {
        this.status.logTail.splice(0, this.status.logTail.length - maxLogLines);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      this.status = {
        ...this.status,
        state: "failed",
        finishedAt: new Date().toISOString(),
        errorMessage: error.message
      };
      void writeLog("error", "OCR runtime installer failed to start", { error: error.message });
    });
    child.on("close", (code) => {
      this.child = null;
      const ok = code === 0;
      this.status = {
        ...this.status,
        state: ok ? "succeeded" : "failed",
        finishedAt: new Date().toISOString(),
        exitCode: code,
        errorMessage: ok ? null : `OCR 运行环境安装失败，退出码 ${code ?? "unknown"}`
      };
      void writeLog(ok ? "info" : "error", "OCR runtime installer finished", {
        exitCode: code,
        state: this.status.state
      });
      void ocrProcessManager.checkRuntime(true);
    });

    return this.getStatus();
  }
}

export const ocrRuntimeInstaller = new OcrRuntimeInstaller();
