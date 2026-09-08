import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const webRoot = join(import.meta.dirname, "..");

test("installable PWA icons include real 192 and 512 pixel PNG assets", () => {
  const manifest = JSON.parse(
    readFileSync(join(webRoot, "public", "manifest.webmanifest"), "utf8"),
  );
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (entry: { type: string; sizes: string }) =>
        entry.type === "image/png" && entry.sizes === `${size}x${size}`,
    );
    assert.ok(icon, `missing ${size}px PNG`);
    const png = readFileSync(join(webRoot, "public", icon.src));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test("the Web product exposes one installable PWA shell without caching canonical APIs", () => {
  const index = readFileSync(join(webRoot, "index.html"), "utf8");
  const manifest = JSON.parse(
    readFileSync(join(webRoot, "public", "manifest.webmanifest"), "utf8"),
  ) as {
    display?: string;
    icons?: unknown[];
    start_url?: string;
  };
  const main = readFileSync(join(webRoot, "src", "main.tsx"), "utf8");
  const viteConfig = readFileSync(join(webRoot, "vite.config.ts"), "utf8");
  const worker = readFileSync(join(webRoot, "public", "sw.js"), "utf8");

  assert.match(index, /rel="manifest" href="\/manifest\.webmanifest"/u);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok((manifest.icons?.length ?? 0) > 0);
  assert.match(main, /serviceWorker\.register\("\/sw\.js"\)/u);
  assert.match(
    viteConfig,
    /assetsInlineLimit:\s*0/u,
    "production assets must stay same-origin instead of weakening CSP with data: fonts",
  );
  assert.match(worker, /request\.mode === "navigate"/u);
  assert.equal(worker.includes("/^\\/v\\d+\\//u"), true);
  assert.match(worker, /pathname\.startsWith\("\/_rah\/"\)/u);
  assert.match(worker, /event\.respondWith\(fetch\(request\)\)/u);
  assert.match(worker, /OWNED_CACHE_PREFIXES/u);
  assert.doesNotMatch(
    worker,
    /names\s*\.filter\(\(name\) => name !== CACHE_NAME\)/u,
  );
  assert.doesNotMatch(worker, /indexedDB|localStorage|\/v3\/client.*put/iu);
});
