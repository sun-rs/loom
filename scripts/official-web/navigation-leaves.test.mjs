import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(p, "utf8");
test("navigation and follower badges do not import parent pages or their cloud state", () => {
  for (const name of [
    "Navigation.tsx",
    "SavedNav.tsx",
    "OfficialThreadAgentFollowerRow.generated.tsx",
  ]) {
    const source = read("frontends/raft/loom/" + name);
    assert.doesNotMatch(
      source,
      /from ["'][^"']*(?:layout\/(?:LeftRail|Sidebar)|agent\/ChannelMembers)["']/,
    );
    assert.match(source, /OfficialNavigationLeaves.generated/);
  }
});
import { generateNavigationLeaves } from "./generate-navigation-leaves.mjs";
test("pinned declarations regenerate exactly without page stores", () => {
  const generated = generateNavigationLeaves();
  assert.equal(
    read("frontends/raft/loom/OfficialNavigationLeaves.generated.tsx"),
    generated,
  );
  assert.doesNotMatch(generated, /store\/|api\/|lazy\(/);
});
test("upgrade rehearsal fails closed on missing or renamed source declarations", () => {
  assert.throws(
    () =>
      generateNavigationLeaves((p) =>
        read(p).replace(
          "export const RailTabButton =",
          "export const RenamedRailTabButton =",
        ),
      ),
    /Official navigation declaration changed: RailTabButton \(0\)/,
  );
});
test("upgrade rehearsal exposes upstream presentation changes in the generated diff", () => {
  const changed = generateNavigationLeaves((p) =>
    read(p).replace(
      "size-10 [@media(max-height:600px)]",
      "size-12 [@media(max-height:600px)]",
    ),
  );
  assert.notEqual(changed, generateNavigationLeaves());
  assert.match(changed, /size-12 \[@media/);
});
