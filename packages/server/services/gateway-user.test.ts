import assert from "node:assert/strict";
import test from "node:test";
import type { H3Event } from "h3";
import { getGatewayUser } from "../utils/gateway-user.ts";

function event(headers: Record<string, string | undefined> = {}) {
  return {
    req: {
      headers: new Headers(Object.entries(headers).filter((entry): entry is [string, string] => {
        return typeof entry[1] === "string";
      }))
    }
  } as unknown as H3Event;
}

test("falls back to local development user mode without fnOS socket", () => {
  const previousSocketPath = process.env.FNOS_SOCKET_PATH;
  delete process.env.FNOS_SOCKET_PATH;
  try {
    assert.deepEqual(getGatewayUser(event({
      "x-trim-userid": "gateway-user",
      "x-trim-username": "Gateway User",
      "x-trim-isadmin": "true"
    })), {
      authenticated: false,
      uid: null,
      username: null,
      isAdmin: false
    });
  } finally {
    if (previousSocketPath === undefined) delete process.env.FNOS_SOCKET_PATH;
    else process.env.FNOS_SOCKET_PATH = previousSocketPath;
  }
});

test("reads fnOS gateway identity headers when running behind gateway", () => {
  const previousSocketPath = process.env.FNOS_SOCKET_PATH;
  process.env.FNOS_SOCKET_PATH = "/tmp/fnos.sock";
  try {
    assert.deepEqual(getGatewayUser(event({
      "x-trim-userid": " user-a ",
      "x-trim-username": " User A ",
      "x-trim-isadmin": "1"
    })), {
      authenticated: true,
      uid: "user-a",
      username: "User A",
      isAdmin: true
    });
  } finally {
    if (previousSocketPath === undefined) delete process.env.FNOS_SOCKET_PATH;
    else process.env.FNOS_SOCKET_PATH = previousSocketPath;
  }
});
