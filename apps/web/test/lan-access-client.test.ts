import assert from "node:assert/strict";
import test from "node:test";

import { LanAccessClient } from "../src/lan-access-client.ts";

test("LAN access client uses only same-origin edge routes and never sends a Human token", async () => {
  const requests: Array<{ init?: RequestInit; url: string }> = [];
  const client = new LanAccessClient({
    fetch: async (url, init) => {
      requests.push({ init, url: String(url) });
      if (String(url) === "/_rah/session") {
        return jsonResponse({
          authenticated: true,
          device: device("device-current", "Chrome"),
        });
      }
      if (String(url) === "/_rah/devices") {
        return jsonResponse({
          devices: [
            device("device-current", "Chrome"),
            device("device-phone", "iPhone"),
          ],
        });
      }
      if (String(url) === "/_rah/pairing-codes") {
        return jsonResponse(
          {
            code: "ABCD-EFGH-JK23",
            expiresAt: "2026-08-28T10:10:00.000Z",
            inviteId: "32a9c2b2-92a0-4b68-9940-ffb8eb703248",
          },
          201,
        );
      }
      if (String(url) === "/_rah/devices/device-phone/revoke") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL ${String(url)}`);
    },
  });

  assert.equal((await client.session()).available, true);
  assert.equal((await client.listDevices()).length, 2);
  assert.equal((await client.issuePairingCode()).code, "ABCD-EFGH-JK23");
  await client.revokeDevice("device-phone");

  assert.deepEqual(
    requests.map(({ init, url }) => ({
      authorization:
        init?.headers instanceof Headers
          ? init.headers.get("authorization")
          : undefined,
      credentials: init?.credentials,
      method: init?.method ?? "GET",
      url,
    })),
    [
      {
        authorization: undefined,
        credentials: "same-origin",
        method: "GET",
        url: "/_rah/session",
      },
      {
        authorization: undefined,
        credentials: "same-origin",
        method: "GET",
        url: "/_rah/devices",
      },
      {
        authorization: undefined,
        credentials: "same-origin",
        method: "POST",
        url: "/_rah/pairing-codes",
      },
      {
        authorization: undefined,
        credentials: "same-origin",
        method: "POST",
        url: "/_rah/devices/device-phone/revoke",
      },
    ],
  );
});

test("LAN access client feature-detects loopback and rejects malformed edge data", async () => {
  const absent = new LanAccessClient({
    fetch: async () => new Response("Not found", { status: 404 }),
  });
  assert.deepEqual(await absent.session(), { available: false });

  const malformed = new LanAccessClient({
    fetch: async () => jsonResponse({ authenticated: true, device: {} }),
  });
  await assert.rejects(() => malformed.session(), /malformed LAN device/u);
});

test("LAN access client binds the host fetch implementation", async () => {
  const originalFetch = globalThis.fetch;
  let observedThis: unknown;
  globalThis.fetch = async function (this: unknown) {
    observedThis = this;
    return jsonResponse({ authenticated: false }, 401);
  };

  try {
    const client = new LanAccessClient();
    assert.deepEqual(await client.session(), {
      authenticated: false,
      available: true,
    });
    assert.equal(observedThis, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function device(deviceId: string, displayName: string) {
  return {
    createdAt: "2026-08-28T10:00:00.000Z",
    deviceId,
    displayName,
    lastSeenAt: "2026-08-28T10:00:00.000Z",
    revokedAt: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
