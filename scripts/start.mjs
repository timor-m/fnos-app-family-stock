#!/usr/bin/env node

import { chmodSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import templateConfig from "../template.config.json" with { type: "json" };

const socketPath = process.env.FNOS_SOCKET_PATH || "";
const port = Number(process.env.PORT || process.env.NITRO_PORT || templateConfig.localDevPort);
const host = process.env.HOST || process.env.NITRO_HOST || "127.0.0.1";

process.env.NODE_ENV ||= socketPath ? "production" : "development";

const { handleUpgrade, middleware } = await import("../.server-dist/server/index.mjs");
const server = createServer(middleware);

if (handleUpgrade) {
  server.on("upgrade", handleUpgrade);
}

function cleanupSocket() {
  if (socketPath) {
    rmSync(socketPath, { force: true });
  }
}

function shutdown() {
  cleanupSocket();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

if (socketPath) {
  cleanupSocket();
  server.listen(socketPath, () => {
    chmodSync(socketPath, 0o660);
    console.log(`fnOS gateway socket listening at ${socketPath}`);
  });
} else {
  server.listen(port, host, () => {
    console.log(`Nitro listening at http://${host}:${port}${templateConfig.gatewayPrefix}/`);
  });
}
