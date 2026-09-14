import assert from "node:assert/strict";
import test from "node:test";
import {
  recoveryAssetPath,
  recoveryShell,
} from "../src/web-recovery-assets.ts";
test("recovery changes the module graph root without changing business links", () => {
  const html =
    '<script type="module" src="/assets/main.js"></script><a href="/?room=r">Room</a>';
  assert.equal(
    recoveryShell(html, "1234567890123"),
    '<script type="module" src="/_rah/recover/1234567890123/assets/main.js"></script><a href="/?room=r">Room</a>',
  );
  assert.equal(recoveryShell(html, '"><script>'), html);
  assert.equal(
    recoveryAssetPath("/_rah/recover/1234567890123/assets/chunk.js"),
    "/assets/chunk.js",
  );
  for (const path of [
    "/_rah/recover/1234567890123/v3/client/health",
    "/_rah/recover/1234567890123/assets/../state",
    "/_rah/recover/1234567890123/assets/%2e%2e/state",
  ])
    assert.equal(recoveryAssetPath(path), undefined);
});

test("formal HTTP gateway serves recovery shell and assets, never aliases API", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { LocalWorkbenchGateway } =
    await import("../src/local-workbench-gateway.ts");
  const directory = mkdtempSync(join(tmpdir(), "rah-recovery-gateway-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "index.html"),
    '<script type="module" src="/assets/main.js"></script>',
  );
  writeFileSync(join(directory, "assets/main.js"), 'import "./child.js"');
  writeFileSync(join(directory, "assets/child.js"), "export {}");
  const gateway = new LocalWorkbenchGateway({
    accessToken: "test-human",
    browserAccess: "trusted-network",
    daemonOrigin: "http://127.0.0.1:1",
    port: 0,
    staticDirectory: directory,
  });
  try {
    await gateway.start();
    const origin = gateway.origin;
    const html = await (
      await fetch(origin + "/?rah_recover=1234567890123&room=existing")
    ).text();
    assert.match(html, /src="\/_rah\/recover\/1234567890123\/assets\/main.js"/);
    const asset = await fetch(
      origin + "/_rah/recover/1234567890123/assets/child.js",
    );
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("cache-control"), "no-store");
    assert.equal(await asset.text(), "export {}");
    assert.equal(
      (await fetch(origin + "/_rah/recover/1234567890123/v3/client/health"))
        .status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/_rah/recover/1234567890123/assets/absent.js"))
        .status,
      404,
    );
  } finally {
    await gateway.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
