import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
const ca = readFileSync("/Users/sun/.loom/evo/tls/local-ca.crt");
async function read(scheme, path, body, encoding) {
  const origin =
    scheme === "https"
      ? "https://192.168.1.86:4178"
      : "http://192.168.1.86:4176";
  return new Promise((resolve, reject) => {
    const req = (scheme === "https" ? https : http).request(
      origin + path,
      {
        ca,
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "accept-encoding": encoding,
        },
      },
      (r) => {
        let chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          const raw = Buffer.concat(chunks),
            decoded =
              r.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
          resolve({
            status: r.statusCode,
            headers: r.headers,
            bytes: raw.length,
            data: JSON.parse(decoded),
          });
        });
        r.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
const ws = await read("http", "/v3/client/workspaces/list", {}, "identity");
const workspaceId = ws.data.workspaces[0].workspaceId;
const rows = [];
for (const scheme of ["http", "https"]) {
  const plain = await read(
      scheme,
      "/v3/client/rooms/list",
      { workspaceId },
      "identity",
    ),
    zip = await read(scheme, "/v3/client/rooms/list", { workspaceId }, "gzip");
  assert.equal(plain.status, 200);
  assert.equal(zip.headers["content-encoding"], "gzip");
  assert.deepEqual(zip.data, plain.data);
  rows.push({
    scheme,
    identityBytes: plain.bytes,
    gzipBytes: zip.bytes,
    decodedEqual: true,
    status: zip.status,
  });
}
writeFileSync(
  "/Users/sun/.loom/reviews/2026-10-23-page-performance/wire.json",
  JSON.stringify(rows, null, 2),
);
console.log(rows);
