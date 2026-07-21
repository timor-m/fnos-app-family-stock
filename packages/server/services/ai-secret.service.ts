import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAppConfig } from "../utils/runtime-config.ts";

const encryptionVersion = "v1";
const algorithm = "aes-256-gcm";

function keyPath() {
  return join(getAppConfig().storageDir, "secrets", "ai-settings.key");
}

function loadOrCreateKey() {
  const path = keyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    const key = readFileSync(path);
    if (key.length !== 32) throw new Error("AI 配置密钥格式无效");
    chmodSync(path, 0o600);
    return key;
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code?: string }).code)
      : "";
    if (code !== "ENOENT") throw error;
  }

  const key = randomBytes(32);
  writeFileSync(path, key, { flag: "wx", mode: 0o600 });
  return key;
}

export function encryptAiSecret(value: string) {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, loadOrCreateKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [encryptionVersion, iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptAiSecret(value: string) {
  if (!value) return "";
  const [version, ivValue, authTagValue, encryptedValue, extra] = value.split(":");
  if (version !== encryptionVersion || !ivValue || !authTagValue || !encryptedValue || extra !== undefined) {
    throw new Error("AI 配置密文格式无效");
  }
  const decipher = createDecipheriv(algorithm, loadOrCreateKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
