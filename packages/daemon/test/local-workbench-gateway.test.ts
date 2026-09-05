import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, get as httpGet, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LocalWorkbenchGateway } from "../src/local-workbench-gateway.ts";

test("the local workbench gateway keeps Human authority server-side", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-workbench-gateway-"));
  const staticDirectory = join(directory, "dist");
  mkdirSync(join(staticDirectory, "assets"), { recursive: true });
  writeFileSync(
    join(staticDirectory, "index.html"),
    '<!doctype html><div id="root">RAH OS</div>',
  );
  writeFileSync(
    join(staticDirectory, ".rah-web-build.json"),
    JSON.stringify({ schemaVersion: 1, webBuildId: "web-generation-local" }),
  );
  writeFileSync(join(staticDirectory, "assets", "app-deadbeef.js"), "ok");
  writeFileSync(join(staticDirectory, "sw.js"), "ok");
  const observed: Array<{
    authorization?: string;
    body: string;
    method?: string;
    range?: string;
    url?: string;
  }> = [];
  const upstream = createServer(async (request, response) => {
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
  const gateway = new LocalWorkbenchGateway({
    accessToken: "server-only-human-token",
    daemonOrigin: upstreamOrigin,
    port: 0,
    sessionToken: "a".repeat(43),
    staticDirectory,
  });

  try {
    await gateway.start();
    const origin = gateway.origin;

    const health = await fetch(`${origin}/_rah/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      service: "rah-os-local-core",
      state: "online",
    });
    assert.equal(health.headers.get("cache-control"), "no-store");

    const lanSession = await fetch(`${origin}/_rah/session`);
    assert.equal(lanSession.status, 200);
    assert.deepEqual(await lanSession.json(), { available: false });
    assert.equal(lanSession.headers.get("cache-control"), "no-store");
    assert.equal(lanSession.headers.get("set-cookie"), null);
    assert.equal((await fetch(`${origin}/_rah/devices`)).status, 404);
    assert.equal(
      (await fetch(`${origin}/_rah/session`, { method: "POST" })).status,
      404,
    );
    assert.equal(observed.length, 0);

    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /RAH OS/u);
    assert.match(
      root.headers.get("content-security-policy") ?? "",
      /default-src 'self'/u,
    );
    assert.equal(
      root.headers.get("x-rah-web-build-id"),
      "web-generation-local",
    );
    const setCookie = root.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^rah_workbench_session=/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.doesNotMatch(setCookie, /server-only-human-token/u);
    const cookie = setCookie.split(";", 1)[0]!;

    const unauthenticated = await fetch(`${origin}/v3/client/health`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(
      unauthenticated.headers.get("x-rah-web-build-id"),
      "web-generation-local",
    );
    assert.equal(observed.length, 0);

    const proxied = await fetch(`${origin}/v3/client/health`, {
      headers: {
        authorization: "Bearer browser-controlled-token",
        cookie,
      },
    });
    assert.equal(proxied.status, 200);
    assert.equal(
      proxied.headers.get("x-rah-web-build-id"),
      "web-generation-local",
    );
    assert.deepEqual(observed.at(-1), {
      authorization: "Bearer server-only-human-token",
      body: "",
      method: "GET",
      url: "/v3/client/health",
    });

    const ranged = await fetch(
      `${origin}/v3/client/files/content/attachment-1`,
      {
        headers: { cookie, range: "bytes=1-7" },
      },
    );
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("accept-ranges"), "bytes");
    assert.equal(ranged.headers.get("content-range"), "bytes 1-7/12");
    assert.equal(ranged.headers.get("content-length"), "7");
    assert.equal(await ranged.text(), "AH OS T");
    assert.deepEqual(observed.at(-1), {
      authorization: "Bearer server-only-human-token",
      body: "",
      method: "GET",
      range: "bytes=1-7",
      url: "/v3/client/files/content/attachment-1",
    });

    const rejectedCsrf = await fetch(`${origin}/v3/client/commands/execute`, {
      body: "{}",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://attacker.invalid",
      },
      method: "POST",
    });
    assert.equal(rejectedCsrf.status, 403);
    assert.equal(
      rejectedCsrf.headers.get("x-rah-web-build-id"),
      "web-generation-local",
    );
    assert.equal(observed.length, 2);

    const acceptedMutation = await fetch(
      `${origin}/v3/client/commands/execute`,
      {
        body: '{"type":"test"}',
        headers: {
          "content-type": "application/json",
          cookie,
          origin,
        },
        method: "POST",
      },
    );
    assert.equal(acceptedMutation.status, 200);
    assert.equal(observed.at(-1)?.body, '{"type":"test"}');

    const asset = await fetch(`${origin}/assets/app-deadbeef.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/u);

    const serviceWorker = await fetch(`${origin}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    assert.equal(serviceWorker.headers.get("cache-control"), "no-cache");

    const spaFallback = await fetch(`${origin}/rooms/room-1`);
    assert.equal(spaFallback.status, 200);
    assert.match(await spaFallback.text(), /RAH OS/u);

    assert.equal(await statusWithHost(origin, "attacker.invalid"), 421);

    const unknownApi = await fetch(`${origin}/v9/client/secrets`, {
      headers: { cookie },
    });
    assert.equal(unknownApi.status, 404);
    assert.equal(observed.length, 3);
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

test("shutdown closes a stalled browser request and its upstream before draining Core", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-gateway-stop-"));
  writeFileSync(join(directory, "index.html"), "RAH OS");
  let received!: () => void;
  let disconnected!: () => void;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gone = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const upstream = createServer((request) => {
    request.socket.once("close", disconnected);
    received();
    // Deliberately never finish this response: a browser must not own Core exit.
  });
  const gateway = new LocalWorkbenchGateway({
    accessToken: "test-only-token",
    daemonOrigin: await listen(upstream),
    port: 0,
    sessionToken: "b".repeat(43),
    staticDirectory: directory,
  });
  let request: ReturnType<typeof httpGet> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await gateway.start();
    const root = await fetch(gateway.origin);
    await root.text();
    const cookie = root.headers.get("set-cookie")!.split(";", 1)[0]!;
    request = httpGet(`${gateway.origin}/v3/client/health`, {
      headers: { cookie },
    });
    request.on("error", () => undefined);
    await arrived;
    await Promise.race([
      Promise.all([gateway.stop(), gone]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("gateway shutdown held by open HTTP request")),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    request?.destroy();
    upstream.closeAllConnections();
    await close(upstream);
    await gateway.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test("a local workbench browser session survives a gateway restart and stale sessions renew without HTML parsing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-gateway-session-"));
  writeFileSync(join(directory, "index.html"), "RAH OS");
  const upstream = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  const daemonOrigin = await listen(upstream);
  const sessionToken = "c".repeat(43);
  let first: LocalWorkbenchGateway | undefined;
  let second: LocalWorkbenchGateway | undefined;
  try {
    first = new LocalWorkbenchGateway({
      accessToken: "server-token",
      daemonOrigin,
      port: 0,
      sessionToken,
      staticDirectory: directory,
    });
    await first.start();
    const firstRoot = await fetch(first.origin);
    const originalCookie = firstRoot.headers
      .get("set-cookie")
      ?.split(";", 1)[0];
    assert.notEqual(originalCookie, undefined);
    await first.stop();
    first = undefined;

    second = new LocalWorkbenchGateway({
      accessToken: "server-token",
      daemonOrigin,
      port: 0,
      sessionToken,
      staticDirectory: directory,
    });
    await second.start();
    const resumed = await fetch(`${second.origin}/v3/client/health`, {
      headers: { cookie: originalCookie! },
    });
    assert.equal(resumed.status, 200);

    const stale = await fetch(`${second.origin}/v3/client/health`, {
      headers: {
        cookie: "rah_workbench_session=stale",
        origin: second.origin,
      },
    });
    assert.equal(stale.status, 401);
    assert.match(stale.headers.get("content-type") ?? "", /application\/json/u);
    assert.match(
      stale.headers.get("set-cookie") ?? "",
      /^rah_workbench_session=/u,
    );
    assert.deepEqual(await stale.json(), {
      error: {
        code: "session_expired",
        message: "本地工作台会话已更新，正在重新连接",
      },
    });
  } finally {
    await first?.stop();
    await second?.stop();
    await close(upstream);
    rmSync(directory, { force: true, recursive: true });
  }
});

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) =>
      error === undefined ? resolvePromise() : reject(error),
    );
  });
}

async function statusWithHost(url: string, host: string): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const request = httpGet(url, { headers: { host } }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode ?? 0));
    });
    request.once("error", reject);
  });
}
