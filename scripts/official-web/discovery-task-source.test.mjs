import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("search, activity and task presentation are reproducible pinned-source modules", async () => {
  const { generateDiscoveryTask } =
    await import("./generate-discovery-task.mjs");
  for (const [name, content] of Object.entries(generateDiscoveryTask()))
    assert.equal(
      readFileSync("frontends/raft/loom/" + name, "utf8"),
      content,
      name,
    );
  const vite = readFileSync("frontends/raft/loom/vite.config.ts", "utf8");
  assert.doesNotMatch(
    vite,
    /importer\?\.endsWith\("\/components\/task\/TaskModalHead.tsx"\)/,
  );
});

test("product bridges consume generated boundaries and the official disclosure control", () => {
  for (const [path, name] of Object.entries({
    "packages/web/src/components/search/EntityResultRow.tsx":
      "OfficialSearchEntityRow.generated",
    "packages/web/src/components/search/SearchHomeEntityRow.tsx":
      "OfficialSearchHomeRow.generated",
    "packages/web/src/components/task/TaskModalHead.tsx":
      "OfficialTaskModalHead.generated",
    "loom/ActivityEmpty.tsx": "OfficialActivityEmpty.generated",
  })) {
    const bridge = readFileSync("frontends/raft/" + path, "utf8");
    assert.ok(bridge.includes(name));
    assert.doesNotMatch(bridge, /<div|className=/);
  }
  assert.match(
    readFileSync(
      "frontends/raft/packages/web/src/components/ui/ShowMoreToggle.tsx",
      "utf8",
    ),
    /@loom\/raft-web-source\/ShowMoreToggle/,
  );
});

test("search rows preserve Loom's stable keyboard rail identity", () => {
  assert.match(
    readFileSync(
      "frontends/raft/loom/OfficialSearchEntityRow.generated.tsx",
      "utf8",
    ),
    /data-entity-id=\{result.key\}/,
  );
});
