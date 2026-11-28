/** UUID v4 in both secure contexts and HTTP NAS deployments. */
export function createUuid(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Some browser environments expose the method but refuse to execute it.
    }
  }
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error('当前浏览器不支持安全随机数，请升级浏览器后重试');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
