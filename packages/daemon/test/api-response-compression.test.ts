import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { gunzipSync } from "node:zlib";
import { pipeApiResponse } from "../src/api-response-compression.ts";

async function exchange(
  encoding: string,
  type = "application/json",
  extra: Record<string, string> = {},
) {
  const body = JSON.stringify({ text: "Loom channel history ".repeat(1500) });
  const origin = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": type,
      "content-length": Buffer.byteLength(body),
      ...extra,
    });
    res.end(body);
  });
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");
  const port = (origin.address() as { port: number }).port;
  const gateway = createServer((req, res) => {
    const u = request(`http://127.0.0.1:${port}`, (up) => {
      res.statusCode = 200;
      for (const [k, v] of Object.entries(up.headers))
        if (v !== undefined) res.setHeader(k, v);
      void pipeApiResponse(req, up, res).catch(() => res.destroy());
    });
    u.end();
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  try {
    const result = await new Promise<{
      headers: Record<string, any>;
      body: Buffer;
    }>((resolve, reject) => {
      request(
        `http://127.0.0.1:${(gateway.address() as { port: number }).port}`,
        { headers: { "accept-encoding": encoding } },
        (r) => {
          const chunks: Buffer[] = [];
          r.on("data", (c) => chunks.push(c));
          r.on("end", () =>
            resolve({ headers: r.headers, body: Buffer.concat(chunks) }),
          );
          r.on("error", reject);
        },
      )
        .on("error", reject)
        .end();
    });
    return { ...result, original: body };
  } finally {
    gateway.closeAllConnections();
    origin.closeAllConnections();
    await Promise.all([
      new Promise<void>((r) => gateway.close(() => r())),
      new Promise<void>((r) => origin.close(() => r())),
    ]);
  }
}
test("finite JSON negotiates gzip and preserves exact decoded data", async () => {
  const r = await exchange("gzip, br");
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.equal(r.headers["content-length"], undefined);
  assert.match(r.headers.vary, /Accept-Encoding/i);
  assert.equal(gunzipSync(r.body).toString(), r.original);
  assert.ok(r.body.length < Buffer.byteLength(r.original) / 5);
});
for (const encoding of ["identity", "gzip;q=0, *;q=1"])
  test("identity is preserved for " + encoding, async () => {
    const r = await exchange(encoding);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.body.toString(), r.original);
  });
for (const [name, type, extra] of [
  ["SSE", "text/event-stream", {}],
  ["range", "application/json", { "content-range": "bytes 0-100/200" }],
  [
    "no-transform",
    "application/json",
    { "cache-control": "private, no-transform" },
  ],
] as const)
  test(name + " bypasses compression", async () => {
    const r = await exchange("gzip", type, extra);
    assert.equal(r.headers["content-encoding"], undefined);
    assert.equal(r.body.toString(), r.original);
  });
