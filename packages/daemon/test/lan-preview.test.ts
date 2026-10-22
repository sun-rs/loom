import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { request } from "node:https";
import { LanWorkbenchAccessStore } from "../src/lan-workbench-access-store.ts";
import { LanWorkbenchGateway } from "../src/lan-workbench-gateway.ts";
import { provisionLanCertificate } from "../src/lan-certificate-provisioning.ts";
import { HTML_PREVIEW_CSP } from "../../application-service/src/html-attachment-preview.ts";

test("TLS preview reuses authorized reads, HTML sandbox and isolated signed TLS PDF", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loom-tls-preview-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist/index.html"), "fixture");
  const cert = provisionLanCertificate({
    directory: join(dir, "tls"),
    publicHostname: "127.0.0.1",
  });
  const ca = readFileSync(cert.caCertificatePath);
  let reads = 0,
    denied = false;
  const upstream = createServer(async (req, res) => {
    reads++;
    assert.equal(req.headers.authorization, "Bearer fixture-owner");
    if (denied) {
      res.writeHead(403).end();
      return;
    }
    if (req.url?.includes("/files/html-preview/")) {
      res
        .writeHead(200, {
          "content-type": "text/html",
          "content-security-policy": HTML_PREVIEW_CSP,
          "content-disposition": "inline",
        })
        .end("<h1>attachment fixture</h1>");
      return;
    }
    if (req.url?.includes("/files/pdf-preview/")) {
      res
        .writeHead(206, {
          "content-type": "application/pdf",
          "content-range": "bytes 0-7/16",
        })
        .end("%PDF-1.7");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const pdf = input.path.endsWith(".pdf");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        kind: "read",
        value: {
          rootId: "runtime-project",
          rootKind: "runtime-project",
          rootLabel: "fixture",
          path: input.path,
          encoding: pdf ? "base64" : "utf-8",
          content: pdf
            ? Buffer.from("%PDF-1.7 fixture").toString("base64")
            : "<h1>HTML fixture</h1>",
          mimeType: pdf ? "application/pdf" : "text/html",
          size: 20,
        },
      }),
    );
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  assert.ok(addr && typeof addr !== "string");
  const gateway = new LanWorkbenchGateway({
    browserAccess: "trusted-network",
    accessToken: "fixture-owner",
    bindHost: "127.0.0.1",
    publicHostname: "127.0.0.1",
    port: 0,
    daemonOrigin: `http://127.0.0.1:${addr.port}`,
    staticDirectory: join(dir, "dist"),
    tls: {
      certificate: readFileSync(cert.certificatePath),
      privateKey: readFileSync(cert.privateKeyPath),
    },
  });
  const get = (
    url: string,
    method = "GET",
    headers: Record<string, string> = {},
  ) =>
    new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const req = request(url, { method, headers, ca }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  try {
    await gateway.start();
    const input = {
      roomId: "fixture",
      rootId: "runtime-project",
      path: "a.html",
      operation: "read",
      includeHidden: false,
    };
    const htmlUrl =
      gateway.origin +
      "/_rah/workspace-preview/html?input=" +
      encodeURIComponent(JSON.stringify(input));
    const paired = new LanWorkbenchGateway({
      accessStore: new LanWorkbenchAccessStore({
        path: join(dir, "access.json"),
      }),
      accessToken: "fixture-owner",
      bindHost: "127.0.0.1",
      publicHostname: "127.0.0.1",
      port: 0,
      daemonOrigin: `http://127.0.0.1:${addr.port}`,
      staticDirectory: join(dir, "dist"),
      tls: {
        certificate: readFileSync(cert.certificatePath),
        privateKey: readFileSync(cert.privateKeyPath),
      },
    });
    try {
      await paired.start();
      const before = reads;
      assert.equal(
        (await get(htmlUrl.replace(gateway.origin, paired.origin))).status,
        403,
      );
      assert.equal(
        (
          await get(
            paired.origin +
              "/_rah/pdf-preview/00000000-0000-0000-0000-000000000001",
            "POST",
            { origin: paired.origin },
          )
        ).status,
        403,
      );
      assert.equal(reads, before);
    } finally {
      await paired.stop();
    }
    const html = await get(htmlUrl);
    assert.equal(html.status, 200);
    assert.equal(html.headers["content-security-policy"], HTML_PREVIEW_CSP);
    assert.notEqual(html.headers["x-frame-options"], "DENY");
    assert.match(html.body, /acBridgeNonce/);
    const attachment = await get(
      gateway.origin + "/v3/client/files/html-preview/fixture",
    );
    assert.equal(
      attachment.headers["content-security-policy"],
      HTML_PREVIEW_CSP,
    );
    assert.notEqual(attachment.headers["x-frame-options"], "DENY");
    const pdfUrl = htmlUrl
      .replace("/html?", "/pdf?")
      .replace("a.html", "a.pdf");
    const before = reads;
    assert.equal(
      (await get(pdfUrl, "POST", { origin: "https://foreign.invalid" })).status,
      403,
    );
    assert.equal(reads, before);
    assert.equal((await get(pdfUrl)).status, 405);
    const issued = await get(pdfUrl, "POST", { origin: gateway.origin });
    assert.equal(issued.status, 200);
    const signed = JSON.parse(issued.body).url;
    assert.equal(new URL(signed).protocol, "https:");
    assert.notEqual(new URL(signed).origin, gateway.origin);
    const shell = await get(gateway.origin);
    assert.ok(
      shell.headers["content-security-policy"]?.includes(
        new URL(signed).origin,
      ),
    );
    const pdf = await get(signed);
    assert.equal(pdf.status, 200);
    assert.match(pdf.body, /^%PDF-/);
    assert.equal(
      pdf.headers["content-security-policy"],
      `frame-ancestors ${gateway.origin}; object-src 'none'; base-uri 'none'; form-action 'none'`,
    );
    assert.equal(
      (await get(signed.replace("signature=", "signature=0"))).status,
      403,
    );
    const aid = "00000000-0000-0000-0000-000000000001";
    const issuedAttachment = await get(
      gateway.origin + "/_rah/pdf-preview/" + aid,
      "POST",
      { origin: gateway.origin },
    );
    assert.equal(issuedAttachment.status, 200);
    assert.equal(
      (
        await get(JSON.parse(issuedAttachment.body).url, "GET", {
          range: "bytes=0-7",
        })
      ).status,
      206,
    );
    denied = true;
    assert.equal((await get(signed)).status, 403);
    await gateway.stop();
    await assert.rejects(get(signed));
  } finally {
    await gateway.stop();
    await new Promise<void>((r) => {
      upstream.close(() => r());
      upstream.closeAllConnections();
    });
    rmSync(dir, { recursive: true, force: true });
  }
});
