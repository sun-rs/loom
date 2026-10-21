import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("message hits, activity toolbar and conversation identity use generated official boundaries", async () => {
  const { generateDiscoveryTask } =
    await import("./generate-discovery-task.mjs");
  const generated = generateDiscoveryTask();
  for (const name of [
    "OfficialMessageHitRow.generated.tsx",
    "OfficialActivityFilters.generated.tsx",
    "OfficialConversationAvatar.generated.tsx",
  ]) {
    assert.ok(generated[name], name);
    assert.equal(read("loom/" + name), generated[name]);
  }
  assert.match(
    read("packages/web/src/components/search/MessageHitRow.tsx"),
    /OfficialMessageHitRow.generated/,
  );
  assert.match(
    read("loom/ActivityFilters.tsx"),
    /OfficialActivityFilters.generated/,
  );
  assert.match(
    read("loom/ActivityMessageRow.tsx"),
    /<OfficialConversationAvatar/,
  );
  assert.match(
    generated["OfficialMessageHitRow.generated.tsx"],
    /data-result-id=\{resultKey\}/,
  );
  assert.match(
    generated["OfficialMessageHitRow.generated.tsx"],
    /<ThreadIcon width=\{12\} height=\{12\}/,
  );
  assert.match(
    generated["OfficialActivityFilters.generated.tsx"],
    /bg-layer-canvas/,
  );
  assert.match(
    generated["OfficialConversationAvatar.generated.tsx"],
    /<IconTile>/,
  );
});
test("pure search grouping is a direct official dependency, not a second implementation", () => {
  assert.match(
    read("packages/web/src/components/search/searchGrouping.ts"),
    /@loom\/raft-web-source\/searchGrouping/,
  );
});
