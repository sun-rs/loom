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
  writeFileSync(join(staticDirectory, "assets", "app-deadbeef.js"), "ok");
  writeFileSync(join(staticDirectory, "sw.js"), "ok");
  const observed: Array<{
    authorization?: string;
    body: string;
    method?: string;
    url?: string;
  }> = [];
  const upstream = createServer(async (request, response) => {
    observed.push({
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
      body: await requestBody(request),
      ...(request.method === undefined ? {} : { method: request.method }),
      ...(request.url === undefined ? {} : { url: request.url }),
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = new LocalWorkbenchGateway({
    accessToken: "server-only-human-token",
    daemonOrigin: upstreamOrigin,
    port: 0,
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

    const root = await fetch(`${origin}/`);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /RAH OS/u);
    assert.match(
      root.headers.get("content-security-policy") ?? "",
      /default-src 'self'/u,
    );
    const setCookie = root.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^rah_workbench_session=/u);
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.doesNotMatch(setCookie, /server-only-human-token/u);
    const cookie = setCookie.split(";", 1)[0]!;

    const unauthenticated = await fetch(`${origin}/v3/client/health`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(observed.length, 0);

    const proxied = await fetch(`${origin}/v3/client/health`, {
      headers: {
        authorization: "Bearer browser-controlled-token",
        cookie,
      },
    });
    assert.equal(proxied.status, 200);
    assert.deepEqual(observed.at(-1), {
      authorization: "Bearer server-only-human-token",
      body: "",
      method: "GET",
      url: "/v3/client/health",
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
    assert.equal(observed.length, 1);

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

    const LANOnlySession = await fetch(`${origin}/_rah/session`);
    assert.equal(LANOnlySession.status, 404);
    assert.equal(LANOnlySession.headers.get("set-cookie"), null);

    const spaFallback = await fetch(`${origin}/rooms/room-1`);
    assert.equal(spaFallback.status, 200);
    assert.match(await spaFallback.text(), /RAH OS/u);

    assert.equal(await statusWithHost(origin, "attacker.invalid"), 421);

    const unknownApi = await fetch(`${origin}/v9/client/secrets`, {
      headers: { cookie },
    });
    assert.equal(unknownApi.status, 404);
    assert.equal(observed.length, 2);
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

async function statusWithHost(url: string, host: string): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const request = httpGet(url, { headers: { host } }, (response) => {
      response.resume();
      response.once("end", () => resolvePromise(response.statusCode ?? 0));
    });
    request.once("error", reject);
  });
}
