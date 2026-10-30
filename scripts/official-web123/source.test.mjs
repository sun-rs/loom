import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = resolve("frontends/raft/upstream/web-1.21.23");
test("complete Web1.21.23 source and official workspace closure are immutable and use their original dependency lock", () => {
  const lock = JSON.parse(readFileSync(root + "/source-lock.json", "utf8"));
  assert.equal(lock.revision, "db5e399f017d584e49597e3a28757645d6807893");
  const files = Object.keys(lock.files);
  assert.ok(files.length > 1000);
  for (const [path, sha] of Object.entries(lock.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(root + "/" + path))
        .digest("hex"),
      sha,
      path,
    );
  const pkg = JSON.parse(
    readFileSync(root + "/packages/web/package.json", "utf8"),
  );
  assert.equal(pkg.version, "1.21.23");
  assert.equal(pkg.dependencies["@botiverse/raft-ui"], "0.7.0");
  assert.equal(pkg.dependencies["raft-ui"], "npm:@botiverse/raft-ui@0.7.0");
  for (const path of [
    "src/App.tsx",
    "src/components/layout/MainLayout.tsx",
    "src/components/layout/Sidebar.tsx",
    "src/components/message/ChatPanel.tsx",
    "src/components/settings/SettingsPanel.tsx",
    "src/components/agent/AgentDetailPanel.tsx",
    "visual-testing/VisualTestingCases.tsx",
  ])
    assert.ok(existsSync(root + "/packages/web/" + path), path);
  for (const name of [
    "shared",
    "sync-core",
    "runtime-form",
    "desktop-contract",
    "visual-testing",
  ])
    assert.ok(existsSync(root + "/packages/" + name + "/package.json"), name);
  function scan(path) {
    for (const e of readdirSync(root + "/" + path, { withFileTypes: true })) {
      if (["node_modules", "dist"].includes(e.name)) continue;
      const file = (path ? path + "/" : "") + e.name;
      if (e.isDirectory()) scan(file);
      else if (file !== "source-lock.json")
        assert.ok(Object.hasOwn(lock.files, file), "unlocked source " + file);
    }
  }
  scan("");
});
