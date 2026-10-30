import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateSidebarDrag140 } from "./generate-sidebar-drag140.mjs";
test("full-release sidebar drag declarations, collision/projection, hint and captions regenerate exactly", async () => {
  const r = await generateSidebarDrag140(),
    base = "frontends/raft/loom/";
  assert.equal(
    readFileSync(base + "OfficialSidebarDrag140.generated.js", "utf8"),
    r.js,
  );
  assert.equal(
    readFileSync(base + "OfficialSidebarDrag140.generated.d.ts", "utf8"),
    r.types,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(base + "sidebar-drag.provenance.json", "utf8")),
    r.provenance,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(base + "sidebar-drag-captions.json", "utf8")),
    r.captions,
  );
  assert.equal(r.captions.pinnedEmptyHint, "将频道或私信拖到这里置顶");
  assert.match(r.js, /mb-1 min-h-9 py-1\.5 transition-colors/);
  assert.match(r.js, /data-sidebar-dnd-container/);
  assert.match(r.js, /data-sidebar-drag-item/);
  assert.match(r.js, /sidebar-drag-overlay/);
});
