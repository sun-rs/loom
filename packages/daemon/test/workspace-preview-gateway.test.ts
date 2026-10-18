import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { serveWorkspacePreview } from "../src/workspace-preview-gateway.ts";
import { PdfPreviewGateway } from "../src/pdf-preview-gateway.ts";
async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const a = s.address();
  assert.ok(a && typeof a !== "string");
  return `http://127.0.0.1:${a.port}`;
}
const close = (s: Server) =>
  new Promise<void>((r) => {
    s.close(() => r());
    s.closeAllConnections();
  });
test("workspace HTML reuses official sandbox/reporter, refuses unauthorized and non-HTML reads", async () => {
  let reads = 0;
  const upstream = createServer(async (req, res) => {
    reads++;
    assert.equal(req.headers.authorization, "Bearer owner");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(input.path, "a.html");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        kind: "read",
        value: {
          rootId: "runtime-project",
          rootKind: "runtime-project",
          rootLabel: "工作区",
          path: input.path,
          encoding: "utf-8",
          content: "<h1>preview</h1>",
          mimeType: "text/plain",
          size: 16,
        },
      }),
    );
  });
  const daemonOrigin = await listen(upstream);
  const pdf = new PdfPreviewGateway({
    host: "127.0.0.1",
    appOrigin: "http://localhost",
    daemonOrigin,
    accessToken: "owner",
  });
  let origin = "";
  const gateway = createServer(
    (req, res) =>
      void serveWorkspacePreview(req, res, {
        daemonOrigin,
        accessToken: "owner",
        pdf,
        authorized: req.headers.cookie === "session=yes",
        origin,
      }),
  );
  origin = await listen(gateway);
  const input = {
    roomId: "r",
    rootId: "runtime-project",
    path: "a.html",
    operation: "read",
    includeHidden: false,
  };
  const url =
    origin +
    "/_rah/workspace-preview/html?input=" +
    encodeURIComponent(JSON.stringify(input));
  try {
    assert.equal((await fetch(url)).status, 403);
    assert.equal(reads, 0);
    const response = await fetch(url, { headers: { cookie: "session=yes" } });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy")!,
      /sandbox allow-scripts/,
    );
    assert.match(
      response.headers.get("content-security-policy")!,
      /frame-ancestors 'self'/,
    );
    const body = await response.text();
    assert.match(body, /<h1>preview/);
    assert.match(body, /acBridgeNonce/);
    assert.equal(
      (
        await fetch(url.replace("a.html", "a.pdf"), {
          headers: { cookie: "session=yes" },
        })
      ).status,
      415,
    );
    assert.equal(reads, 1);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});
