import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectLocalCoreProduct } from "../src/local-core-product.ts";

test("Local Core product inspection verifies the executable and every Web asset", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-core-product-inspect-"));
  try {
    const executablePath = join(directory, "bin", "rah-os-core");
    const indexPath = join(directory, "web", "index.html");
    mkdirSync(join(directory, "bin"), { mode: 0o700 });
    mkdirSync(join(directory, "web"), { mode: 0o700 });
    writeFileSync(executablePath, "core-binary");
    chmodSync(executablePath, 0o500);
    writeFileSync(indexPath, "<!doctype html>RAH");
    writeFileSync(
      join(directory, "product-manifest.json"),
      `${JSON.stringify({
        executable: descriptor("bin/rah-os-core", "core-binary"),
        nodeCarrierVersion: "v26.8.1",
        platformKey: `${process.platform}-${process.arch}`,
        product: "rah-os-local-core",
        schemaVersion: 1,
        version: "0.1.0",
        web: {
          files: [descriptor("web/index.html", "<!doctype html>RAH")],
          root: "web",
        },
      })}\n`,
    );

    const inspected = await inspectLocalCoreProduct(directory);
    assert.equal(inspected.executablePath, executablePath);
    assert.equal(inspected.staticDirectory, join(directory, "web"));
    assert.equal(inspected.version, "0.1.0");
    assert.deepEqual(inspected.runnerIntegrity, {
      sha256: descriptor("ignored", "core-binary").sha256,
      size: 11,
    });

    writeFileSync(indexPath, "tampered");
    await assert.rejects(
      inspectLocalCoreProduct(directory),
      /product file digest does not match/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function descriptor(path: string, contents: string) {
  const bytes = Buffer.from(contents);
  return {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}
