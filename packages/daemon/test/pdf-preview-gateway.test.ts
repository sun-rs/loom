import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { PdfPreviewGateway } from "../src/pdf-preview-gateway.ts";

const read = (url: string, options?: RequestInit) =>
  fetch(url, { ...options, headers: { connection: "close" } });

test("PDF origin grants only one attachment, expires, and forwards no browser authority", async () => {
  let now = 1000;
  let observed = "";
  let denied = false;
  const upstream = createServer((req, res) => {
    observed = req.url!;
    if (denied) {
      res.statusCode = 403;
      res.end();
      return;
    }
    assert.equal(req.headers.authorization, "Bearer owner");
    assert.equal(req.headers.cookie, undefined);
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", "inline");
    res.end("%PDF-1.7");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const gateway = new PdfPreviewGateway({
    host: "127.0.0.1",
    appOrigin: "http://127.0.0.1:4176",
    daemonOrigin: `http://127.0.0.1:${address.port}`,
    accessToken: "owner",
    now: () => now,
  });
  try {
    await gateway.start();
    const id = "11111111-1111-4111-8111-111111111111";
    const url = await gateway.issue(id);
    assert.notEqual(new URL(url).origin, "http://127.0.0.1:4176");
    const result = await read(url);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "%PDF-1.7");
    assert.equal(observed, `/v3/client/files/pdf-preview/${id}`);
    assert.equal(
      (await read(url.replace(id, "22222222-2222-4222-8222-222222222222")))
        .status,
      403,
    );
    assert.equal((await read(url, { method: "POST" })).status, 405);
    assert.equal((await read(gateway.origin + "/v3/client/rooms")).status, 404);
    denied = true;
    assert.equal((await read(url)).status, 403);
    await assert.rejects(() => gateway.issue(id));
    denied = false;
    now += 31 * 60 * 1000;
    assert.equal((await read(url)).status, 403);
    const beforeRestart = await gateway.issue(id);
    const origin = gateway.origin;
    await gateway.stop();
    const restarted = new PdfPreviewGateway({
      host: "127.0.0.1",
      port: Number(new URL(origin).port),
      appOrigin: "http://127.0.0.1:4176",
      daemonOrigin: `http://127.0.0.1:${address.port}`,
      accessToken: "owner",
      now: () => now,
    });
    try {
      await restarted.start();
      assert.equal(restarted.origin, origin);
      assert.equal((await read(beforeRestart)).status, 403);
      assert.equal((await read(await restarted.issue(id))).status, 200);
    } finally {
      await restarted.stop();
    }
  } finally {
    await gateway.stop();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});
