import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendStaticFile } from "../src/static-file-response.ts";

test("static text negotiates gzip without changing content, HEAD or identity fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-static-"));
  const path = join(dir, "app.js");
  const body = "/* stable product asset */\n".repeat(1000);
  writeFileSync(path, body);
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/javascript");
    void sendStaticFile(req, res, path);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/app.js`;
  try {
    for (const encoding of ["gzip", "br, gzip", "gzip;q=0", "identity"]) {
      const response = await fetch(url, {
        headers: { "accept-encoding": encoding },
      });
      assert.equal(
        response.headers.get("content-encoding"),
        encoding.includes("gzip") && !encoding.includes("q=0") ? "gzip" : null,
      );
      assert.equal(response.headers.get("vary"), "Accept-Encoding");
      assert.equal(await response.text(), body);
    }
    const head = await fetch(url, {
      method: "HEAD",
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(head.headers.get("content-encoding"), "gzip");
    assert.equal(await head.text(), "");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
