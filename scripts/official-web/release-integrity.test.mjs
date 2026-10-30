import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyRelease } from "./release-integrity.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "loom-whole-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const release = { releaseId: "fixture-only", branch: "release/v1.21.40" };
  const contents = {
    "index.html": `<script id="raft-frontend-release-identity" type="application/json">${JSON.stringify(release)}</script><script type="module" src="/assets/main.js"></script>`,
    "assets/main.js": 'export const lazy=()=>import("./page.js")',
    "assets/page.js": 'export const page="fixture only"',
  };
  const files = Object.entries(contents).map(([path, content]) => {
    const file = "files/app.raft.build/" + path;
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), content);
    return {
      url: "https://app.raft.build/" + path,
      file,
      sha256: createHash("sha256").update(content).digest("hex"),
      bytes: Buffer.byteLength(content),
      mime: path.endsWith(".html") ? "text/html" : "text/javascript",
      dependencies:
        path === "index.html"
          ? ["https://app.raft.build/assets/main.js"]
          : path.endsWith("main.js")
            ? ["https://app.raft.build/assets/page.js"]
            : [],
      dynamicImports: [],
    };
  });
  const lock = {
    release,
    entry: files[0].url,
    entrySha256: files[0].sha256,
    files,
    staticClosureComplete: true,
    failed: [],
    missingEdges: [],
  };
  const save = () =>
    writeFileSync(join(dir, "release-lock.json"), JSON.stringify(lock));
  save();
  return { dir, lock, save };
}

test("whole release accepts the original graph and rejects missing, changed or foreign files", (t) => {
  const f = fixture(t);
  assert.equal(verifyRelease(f.dir).files, 3);
  writeFileSync(join(f.dir, f.lock.files[2].file), "local UI patch");
  assert.throws(() => verifyRelease(f.dir), /hash|bytes/i);
});

test("a self-consistent lock cannot silently drop an actual lazy module", (t) => {
  const f = fixture(t);
  f.lock.files[1].dependencies = [];
  f.save();
  assert.throws(() => verifyRelease(f.dir), /graph|dependencies/i);
});

test("a release identity mismatch or unsafe path never becomes a new baseline", (t) => {
  const f = fixture(t);
  assert.throws(
    () => verifyRelease(f.dir, { releaseId: "other" }),
    /identity/i,
  );
  f.lock.files[1].file = "../outside.js";
  f.save();
  assert.throws(() => verifyRelease(f.dir), /path/i);
});

test("unlocked candidate files are reported rather than silently omitted", (t) => {
  const f = fixture(t);
  writeFileSync(
    join(f.dir, "files/app.raft.build/assets/unlocked.js"),
    "extra",
  );
  assert.throws(() => verifyRelease(f.dir), /unlocked/i);
});

test("a locked but unreachable old-release file cannot be mixed into the graph", (t) => {
  const f = fixture(t);
  const content = "export const oldPage = true";
  const file = "files/app.raft.build/assets/old-page.js";
  writeFileSync(join(f.dir, file), content);
  f.lock.files.push({
    url: "https://app.raft.build/assets/old-page.js",
    file,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
    mime: "text/javascript",
    dependencies: [],
    dynamicImports: [],
  });
  f.save();
  assert.throws(() => verifyRelease(f.dir), /unreachable/i);
});
