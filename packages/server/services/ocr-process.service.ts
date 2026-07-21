import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { getAppConfig } from "../utils/runtime-config";
import { writeLog } from "../utils/logger";

export type OcrWorkerResult = {
  id: string;
  ok: boolean;
  engine?: string;
  modelVersion?: string;
  lines?: Array<{
    id: string;
    text: string;
    confidence: number;
    box?: number[][];
  }>;
  elapsedMs?: number;
  engineElapsed?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

type RuntimeState = {
  state: "unchecked" | "checking" | "ready" | "unavailable" | "stopped";
  ready: boolean;
  checkedAt: string | null;
  engine: string | null;
  modelVersion: string | null;
  rapidocrVersion: string | null;
  openvinoVersion: string | null;
  pythonVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type PendingRequest = {
  resolve: (result: OcrWorkerResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const initialState: RuntimeState = {
  state: "unchecked",
  ready: false,
  checkedAt: null,
  engine: null,
  modelVersion: null,
  rapidocrVersion: null,
  openvinoVersion: null,
  pythonVersion: null,
  errorCode: null,
  errorMessage: null
};

class OcrProcessManager {
  private state: RuntimeState = { ...initialState };
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private checkPromise: Promise<RuntimeState> | null = null;

  getStatus() {
    return {
      ...this.state,
      running: Boolean(this.child && !this.child.killed),
      pythonBin: getAppConfig().ocrPythonBin,
      workerScript: getAppConfig().ocrWorkerScript
    };
  }

  async checkRuntime(force = false) {
    const checkedAt = this.state.checkedAt ? Date.parse(this.state.checkedAt) : 0;
    if (!force && checkedAt && Date.now() - checkedAt < 60_000) {
      return this.getStatus();
    }
    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.state = { ...this.state, state: "checking", ready: false };
    this.checkPromise = this.runCheck().finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  private runCheck() {
    const config = getAppConfig();
    return new Promise<RuntimeState>((resolve) => {
      const child = spawn(config.ocrPythonBin, [config.ocrWorkerScript, "--check"], {
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (payload?: Record<string, unknown>, fallbackMessage?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const ready = payload?.ok === true;
        this.state = {
          state: ready ? "ready" : "unavailable",
          ready,
          checkedAt: new Date().toISOString(),
          engine: typeof payload?.engine === "string" ? payload.engine : null,
          modelVersion: typeof payload?.modelVersion === "string" ? payload.modelVersion : null,
          rapidocrVersion: typeof payload?.rapidocrVersion === "string" ? payload.rapidocrVersion : null,
          openvinoVersion: typeof payload?.openvinoVersion === "string" ? payload.openvinoVersion : null,
          pythonVersion: typeof payload?.pythonVersion === "string" ? payload.pythonVersion : null,
          errorCode:
            ready
              ? null
              : typeof payload?.errorCode === "string"
                ? payload.errorCode
                : "OCR_RUNTIME_UNAVAILABLE",
          errorMessage:
            ready
              ? null
              : typeof payload?.errorMessage === "string"
                ? payload.errorMessage
                : fallbackMessage || stderr.trim() || "OCR 运行环境不可用"
        };
        resolve(this.state);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(undefined, "OCR 运行环境检查超时");
      }, 15_000);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => finish(undefined, error.message));
      child.on("close", () => {
        try {
          const lastLine = stdout.trim().split("\n").at(-1);
          finish(lastLine ? JSON.parse(lastLine) : undefined);
        } catch (error) {
          finish(undefined, error instanceof Error ? error.message : "OCR 环境检查结果无效");
        }
      });
    });
  }

  private async ensureStarted() {
    if (this.child && !this.child.killed) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.start().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async start() {
    const runtime = await this.checkRuntime();
    if (!runtime.ready) {
      throw new Error(runtime.errorMessage || "OCR 运行环境不可用");
    }

    const config = getAppConfig();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.ocrPythonBin, [config.ocrWorkerScript], {
        stdio: ["pipe", "pipe", "pipe"]
      });
      this.child = child;
      let ready = false;
      const readyTimer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("OCR Worker 启动超时"));
      }, 30_000);
      const reader = createInterface({ input: child.stdout });

      reader.on("line", (line) => {
        let message: OcrWorkerResult & { type?: string };
        try {
          message = JSON.parse(line);
        } catch {
          void writeLog("warn", "Ignored invalid OCR worker output", { line });
          return;
        }

        if (message.type === "ready") {
          clearTimeout(readyTimer);
          if (!message.ok) {
            reject(new Error(message.errorMessage || "OCR Worker 启动失败"));
            return;
          }
          ready = true;
          this.state = {
            ...this.state,
            state: "ready",
            ready: true,
            engine: message.engine || this.state.engine,
            modelVersion: message.modelVersion || this.state.modelVersion,
            errorCode: null,
            errorMessage: null
          };
          resolve();
          return;
        }

        if (!message.id) {
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        pending.resolve(message);
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        void writeLog("warn", "OCR worker stderr", { output: String(chunk).slice(-4000) });
      });
      child.on("error", (error) => {
        clearTimeout(readyTimer);
        if (!ready) reject(error);
        this.handleExit(error);
      });
      child.on("close", (code) => {
        clearTimeout(readyTimer);
        if (!ready) reject(new Error(`OCR Worker 启动失败，退出码 ${code ?? "unknown"}`));
        this.handleExit(new Error(`OCR Worker 已退出，退出码 ${code ?? "unknown"}`));
      });
    });
  }

  private handleExit(error: Error) {
    this.child = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.state = {
      ...this.state,
      state: "stopped",
      ready: false,
      errorCode: "OCR_WORKER_STOPPED",
      errorMessage: error.message
    };
  }

  async recognize(id: string, imagePath: string, imageRole?: string) {
    await this.ensureStarted();
    if (!this.child || this.child.killed) {
      throw new Error("OCR Worker 未运行");
    }

    return new Promise<OcrWorkerResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("OCR 识别超时"));
      }, 180_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ id, imagePath, imageRole })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
  }
}

export const ocrProcessManager = new OcrProcessManager();
