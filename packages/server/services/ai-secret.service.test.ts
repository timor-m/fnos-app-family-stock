import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("encrypts DeepSeek API keys with a separate 0600 key", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), "family-stock-ai-secret-"));
  process.env.STORAGE_DIR = storageDir;
  const { decryptAiSecret, encryptAiSecret } = await import("./ai-secret.service.ts");
  const secret = "sk-test-never-store-plaintext";
  const encrypted = encryptAiSecret(secret);

  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptAiSecret(encrypted), secret);
  assert.equal(statSync(join(storageDir, "secrets", "ai-settings.key")).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(storageDir, "secrets", "ai-settings.key")).length, 32);
  const tampered = encrypted.split(":");
  tampered[3] = `${tampered[3][0] === "A" ? "B" : "A"}${tampered[3].slice(1)}`;
  assert.throws(() => decryptAiSecret(tampered.join(":")));

  rmSync(storageDir, { recursive: true, force: true });
});
