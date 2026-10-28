import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("pinned filter is a real query mode, not filtering only the loaded browser page", () => {
  const page = readFileSync("frontends/raft/loom/DiscoveryPage.tsx", "utf8");
  assert.match(page, /"mentions",\s*"pinned"/);
  assert.match(
    readFileSync(
      "frontends/raft/loom/OfficialActivityFilters.generated.tsx",
      "utf8",
    ),
    /value:\s*"pinned"/,
  );
  assert.match(
    readFileSync(
      "frontends/raft/loom/OfficialActivityEmpty.generated.tsx",
      "utf8",
    ),
    /pinned/,
  );
});
