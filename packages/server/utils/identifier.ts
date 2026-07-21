import { randomUUID } from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
