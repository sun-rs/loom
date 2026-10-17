import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { createAttachmentPreviewBridgeTransform } from "../vendor/raft/attachmentPreviewBridge.ts";

test("official HTML reporter retains pinned source provenance", () => {
  const base = new URL("../vendor/raft/", import.meta.url);
  const source = readFileSync(new URL("attachmentPreviewBridge.ts", base));
  const provenance = JSON.parse(
    readFileSync(new URL("provenance.json", base), "utf8"),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    provenance.sha256,
  );
  const original = source
    .toString()
    .replace(".test(html[end]!)", ".test(html[end])")
    .replace(".test(html[nameStart]!)", ".test(html[nameStart])");
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    provenance.upstreamSha256,
  );
  assert.ok(readFileSync(new URL("LICENSE", base)).length > 100);
});

test("official bridge survives split UTF-8 and precedes document CSP without changing original markup", async () => {
  const html =
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src none"></head><body>中文</body></html>';
  const bytes = Buffer.from(html);
  const chunks = Array.from(bytes, (byte) => Buffer.from([byte]));
  const output = Readable.from(chunks).pipe(
    createAttachmentPreviewBridgeTransform(),
  );
  const result: Buffer[] = [];
  for await (const chunk of output) result.push(Buffer.from(chunk));
  const text = Buffer.concat(result).toString();
  assert.ok(text.indexOf("acBridgeNonce") < text.indexOf("<meta http-equiv"));
  assert.ok(
    text.endsWith(
      '<meta http-equiv="Content-Security-Policy" content="script-src none"></head><body>中文</body></html>',
    ),
  );
});
