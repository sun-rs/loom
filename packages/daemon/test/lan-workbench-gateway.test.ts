import { createConnection } from "node:net";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { request as createHttpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LanWorkbenchAccessStore } from "../src/lan-workbench-access-store.ts";
import { LanWorkbenchGateway } from "../src/lan-workbench-gateway.ts";

test("the formal LAN gateway requires TLS pairing and keeps Human authority server-side", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lan-gateway-"));
  const staticDirectory = join(directory, "dist");
  const stateDirectory = join(directory, "state");
  mkdirSync(join(staticDirectory, "assets"), { recursive: true });
  mkdirSync(stateDirectory, { mode: 0o700 });
  writeFileSync(
    join(staticDirectory, "index.html"),
    '<!doctype html><div id="root">RAH OS</div>',
  );
  writeFileSync(
    join(staticDirectory, ".rah-web-build.json"),
    JSON.stringify({ schemaVersion: 1, webBuildId: "web-generation-lan" }),
  );
  writeFileSync(join(staticDirectory, "assets", "app.js"), "ok");
  writeFileSync(
    join(staticDirectory, "assets", "pdf.worker.mjs"),
    "export {}; ",
  );
  const keyPath = join(directory, "test.key");
  const certificatePath = join(directory, "test.crt");
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
  const observed: Array<{
    authorization?: string;
    body: string;
    method?: string;
    range?: string;
    url?: string;
  }> = [];
  let streamClosed = false;
  let endStream: (() => void) | undefined;
  const upstream = createServer(async (request, response) => {
    if (request.url === "/v3/client/health?stream=1") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: ready\n\n");
      response.on("close", () => {
        streamClosed = true;
      });
      endStream = () => response.end();
      return;
    }
    observed.push({
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
      body: await requestBody(request),
      ...(request.method === undefined ? {} : { method: request.method }),
      ...(request.headers.range === undefined
        ? {}
        : { range: request.headers.range }),
      ...(request.url === undefined ? {} : { url: request.url }),
    });
    if (
      request.url === "/v3/client/files/content/attachment-1" &&
      request.headers.range === "bytes=1-7"
    ) {
      response.statusCode = 206;
      response.setHeader("accept-ranges", "bytes");
      response.setHeader("content-range", "bytes 1-7/12");
      response.setHeader("content-length", "7");
      response.setHeader("content-type", "application/octet-stream");
      response.end("AH OS T");
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  const upstreamOrigin = await listen(upstream);
  const accessStore = new LanWorkbenchAccessStore({
    path: join(stateDirectory, "lan-access.json"),
  });
  const invite = accessStore.issuePairingCode({ ttlMs: 10 * 60_000 });
  assert.throws(
    () =>
      new LanWorkbenchGateway({
        accessStore,
        accessToken: "server-only-human-token",
        bindHost: "127.0.0.1",
        daemonOrigin: upstreamOrigin,
        port: 0,
        publicHostname: "example.invalid",
        staticDirectory,
        tls: {
          certificate: readFileSync(certificatePath),
          privateKey: readFileSync(keyPath),
        },
      }),
    /certificate does not cover the public hostname/u,
  );
  let restartRequests = 0;
  const gateway = new LanWorkbenchGateway({
    serviceControl: {
      status: () => ({ generation: "lan-test", state: "online" }),
      restart: () => {
        restartRequests++;
        return "accepted";
      },
    },
    accessStore,
    accessToken: "server-only-human-token",
    bindHost: "127.0.0.1",
    daemonOrigin: upstreamOrigin,
    port: 0,
    publicHostname: "127.0.0.1",
    staticDirectory,
    tls: {
      certificate: readFileSync(certificatePath),
      privateKey: readFileSync(keyPath),
    },
  });

  try {
    await gateway.start();
    await t.test(
      "explicit trusted HTTPS needs no cookie or pairing but retains host/origin fences",
      async () => {
        const trusted = new LanWorkbenchGateway({
          browserAccess: "trusted-network",
          accessToken: "server-only-human-token",
          bindHost: "127.0.0.1",
          publicHostname: "127.0.0.1",
          port: 0,
          daemonOrigin: upstreamOrigin,
          staticDirectory,
          tls: {
            certificate: readFileSync(certificatePath),
            privateKey: readFileSync(keyPath),
          },
        });
        try {
          await trusted.start();
          const base = trusted.origin;
          try {
            await new Promise<void>((resolve, reject) => {
              const request = createHttpsRequest(
                base + "/v3/client/health?stream=1",
                {
                  ca: readFileSync(certificatePath),
                },
                (response) => {
                  response.once("data", () => {
                    response.destroy();
                    resolve();
                  });
                },
              );
              request.once("error", reject);
              request.end();
            });
            for (let i = 0; i < 20 && !streamClosed; i++)
              await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(
              streamClosed,
              true,
              "browser cancellation must close daemon stream",
            );
          } finally {
            endStream?.();
          }

          for (const host of ["0.0.0.0", "8.8.8.8"]) {
            assert.throws(
              () =>
                new LanWorkbenchGateway({
                  browserAccess: "trusted-network",
                  accessToken: "fixture",
                  bindHost: host,
                  publicHostname: host,
                  port: 0,
                  daemonOrigin: upstreamOrigin,
                  staticDirectory,
                  tls: {
                    certificate: readFileSync(certificatePath),
                    privateKey: readFileSync(keyPath),
                  },
                }),
              /exact private IPv4/,
            );
          }
          const home = await secureRequest(base, "/", {
            headers: { accept: "text/html" },
          });
          assert.equal(home.statusCode, 200);
          assert.equal(home.headers["set-cookie"], undefined);
          assert.match(home.body, /RAH OS/);
          assert.equal(
            (await secureRequest(base, "/v3/client/health")).statusCode,
            200,
          );
          assert.equal(
            (
              await secureRequest(base, "/v3/client/health", {
                method: "POST",
                body: "{}",
                headers: { origin: base },
              })
            ).statusCode,
            200,
          );
          assert.equal(
            observed.at(-1)?.authorization,
            "Bearer server-only-human-token",
          );
          assert.equal(
            (
              await secureRequest(base, "/v3/client/health", {
                method: "POST",
                body: "{}",
                headers: { origin: "https://foreign.invalid" },
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await secureRequest(base, "/", {
                headers: { host: "foreign.invalid" },
              })
            ).statusCode,
            421,
          );
          const oldPair = await secureRequest(base, "/_rah/pair");
          assert.equal(oldPair.statusCode, 303);
          assert.equal(oldPair.headers.location, "/");
          for (const path of ["/_rah/devices", "/_rah/pairing-codes"])
            assert.equal((await secureRequest(base, path)).statusCode, 404);
          assert.equal(
            (await secureRequest(base, "/_rah/service")).statusCode,
            200,
          );
          assert.throws(() => trusted.issuePairingCode(), /disabled/);
        } finally {
          await trusted.stop();
          // The following paired-edge assertions use their own upstream request history.
          observed.length = 0;
        }
      },
    );
    const origin = gateway.origin;
    assert.match(origin, /^https:\/\/127\.0\.0\.1:\d+$/u);

    const health = await secureRequest(origin, "/_rah/health");
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), {
      buildIdentity: {
        schemaVersion: 1,
        kind: "development",
        version: "0.0.0-dev+local",
        buildId: "development",
      },
      service: "rah-os-local-core",
      state: "online",
    });
    assert.equal(health.headers["cache-control"], "no-store");

    const root = await secureRequest(origin, "/", {
      headers: { accept: "text/html" },
    });
    assert.equal(root.statusCode, 303);
    assert.equal(root.headers.location, "/_rah/pair");
    assert.match(
      String(root.headers["strict-transport-security"]),
      /max-age=/u,
    );

    const unauthenticated = await secureRequest(origin, "/v3/client/health");
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(
      unauthenticated.headers["x-rah-web-build-id"],
      "web-generation-lan",
    );
    assert.equal(observed.length, 0);

    const pairingPage = await secureRequest(origin, "/_rah/pair");
    assert.equal(pairingPage.statusCode, 200);
    assert.match(pairingPage.body, /设备配对/u);
    assert.doesNotMatch(pairingPage.body, new RegExp(invite.code, "u"));

    const rejected = await secureRequest(origin, "/_rah/pair", {
      body: "code=WRNG-WRNG-WRNG&deviceName=attacker",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
      },
      method: "POST",
    });
    assert.equal(rejected.statusCode, 401);

    const paired = await secureRequest(origin, "/_rah/pair", {
      body: new URLSearchParams({
        code: invite.code,
        deviceName: "Sun 的 iPhone",
      }).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
      },
      method: "POST",
    });
    assert.equal(paired.statusCode, 303);
    assert.equal(paired.headers.location, "/");
    const setCookie = String(paired.headers["set-cookie"]?.[0] ?? "");
    assert.match(setCookie, /^rah_lan_session=/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /Secure/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.doesNotMatch(setCookie, /server-only-human-token/u);
    const cookie = setCookie.split(";", 1)[0]!;

    const authenticatedRoot = await secureRequest(origin, "/", {
      headers: { accept: "text/html", cookie },
    });
    assert.equal(authenticatedRoot.statusCode, 200);
    assert.match(
      String(authenticatedRoot.headers["content-security-policy"]),
      /media-src 'self' blob:/u,
    );
    assert.match(
      String(authenticatedRoot.headers["content-security-policy"]),
      /frame-src 'self' https:\/\/127\.0\.0\.1:\d+;/u,
    );
    assert.match(authenticatedRoot.body, /RAH OS/u);
    const workerModule = await secureRequest(origin, "/assets/pdf.worker.mjs", {
      headers: { cookie },
    });
    assert.equal(workerModule.statusCode, 200);
    assert.match(String(workerModule.headers["content-type"]), /javascript/u);
    assert.equal(
      authenticatedRoot.headers["x-rah-web-build-id"],
      "web-generation-lan",
    );

    for (const [headers, expected] of [
      [{ origin }, 401],
      [{ cookie, origin: "https://evil.invalid" }, 403],
      [{ cookie, origin }, 202],
    ] as const) {
      const response = await secureRequest(origin, "/_rah/service/restart", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ generation: "lan-test" }),
      });
      assert.equal(response.statusCode, expected);
    }
    assert.equal(restartRequests, 1);
    const session = await secureRequest(origin, "/_rah/session", {
      headers: { cookie },
    });
    assert.equal(session.statusCode, 200);
    const sessionBody = JSON.parse(session.body) as {
      device: { deviceId: string; displayName: string };
    };
    assert.equal(sessionBody.device.displayName, "Sun 的 iPhone");

    const proxied = await secureRequest(origin, "/v3/client/health", {
      headers: {
        authorization: "Bearer browser-controlled-token",
        cookie,
      },
    });
    assert.equal(proxied.statusCode, 200);
    assert.equal(proxied.headers["x-rah-web-build-id"], "web-generation-lan");
    assert.deepEqual(observed.at(-1), {
      authorization: "Bearer server-only-human-token",
      body: "",
      method: "GET",
      url: "/v3/client/health",
    });

    const ranged = await secureRequest(
      origin,
      "/v3/client/files/content/attachment-1",
      {
        headers: { cookie, range: "bytes=1-7" },
      },
    );
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.headers["accept-ranges"], "bytes");
    assert.equal(ranged.headers["content-range"], "bytes 1-7/12");
    assert.equal(ranged.headers["content-length"], "7");
    assert.equal(ranged.body, "AH OS T");
    assert.deepEqual(observed.at(-1), {
      authorization: "Bearer server-only-human-token",
      body: "",
      method: "GET",
      range: "bytes=1-7",
      url: "/v3/client/files/content/attachment-1",
    });

    const rejectedCsrf = await secureRequest(
      origin,
      "/v3/client/commands/execute",
      {
        body: "{}",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "https://attacker.invalid",
        },
        method: "POST",
      },
    );
    assert.equal(rejectedCsrf.statusCode, 403);
    assert.equal(observed.length, 2);

    const devices = await secureRequest(origin, "/_rah/devices", {
      headers: { cookie },
    });
    assert.equal(devices.statusCode, 200);
    assert.doesNotMatch(devices.body, /token|digest/iu);

    const nextInvite = await secureRequest(origin, "/_rah/pairing-codes", {
      body: "{}",
      headers: { "content-type": "application/json", cookie, origin },
      method: "POST",
    });
    assert.equal(nextInvite.statusCode, 201);
    assert.match(
      (JSON.parse(nextInvite.body) as { code: string }).code,
      /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/u,
    );

    const revoked = await secureRequest(
      origin,
      `/_rah/devices/${sessionBody.device.deviceId}/revoke`,
      {
        body: "{}",
        headers: { "content-type": "application/json", cookie, origin },
        method: "POST",
      },
    );
    assert.equal(revoked.statusCode, 204);
    assert.equal(
      (
        await secureRequest(origin, "/v3/client/health", {
          headers: { cookie },
        })
      ).statusCode,
      401,
    );

    const wrongHost = await secureRequest(origin, "/", {
      headers: { host: "attacker.invalid" },
    });
    assert.equal(wrongHost.statusCode, 421);
    await t.test(
      "shutdown closes browser preconnects before TLS handshake",
      async () => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: Number(new URL(origin).port),
        });
        await new Promise<void>((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("error", reject);
        });
        // Let the accepted connection enter TLS parsing, then leave ClientHello incomplete.
        socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x20]));
        await new Promise((resolve) => setTimeout(resolve, 25));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stopped = gateway.stop();
        try {
          const completed = await Promise.race([
            stopped.then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), 1000);
            }),
          ]);
          assert.equal(
            completed,
            true,
            "pending TLS must not block graceful shutdown and Host offline acknowledgement",
          );
        } finally {
          clearTimeout(timer);
          socket.destroy();
          await stopped;
        }
      },
    );
  } finally {
    await gateway.stop();
    await close(upstream);
    rmSync(directory, { force: true, recursive: true });
  }
});

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<string> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind a TCP port");
  }
  return `http://127.0.0.1:${String(address.port)}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    );
  });
}

async function secureRequest(
  origin: string,
  path: string,
  input: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
): Promise<{
  body: string;
  headers: IncomingMessage["headers"];
  statusCode: number;
}> {
  return await new Promise((resolvePromise, reject) => {
    const request = createHttpsRequest(
      new URL(path, origin),
      {
        headers: input.headers,
        method: input.method ?? "GET",
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.once("end", () =>
          resolvePromise({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          }),
        );
      },
    );
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}
