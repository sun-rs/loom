import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8").split(
  "<ComputersPage",
)[1];
const body = source.match(
  /onSelect=\{\(id\) => \{([\s\S]*?)\n                      \}\}/,
)?.[1];
assert.ok(body, "Computer selection binding must remain inspectable");
function select(actualSearch, blocked = false) {
  let navigated;
  // Router setter captured when the Computers page rendered. A later page click
  // has already updated the actual URL before inventory auto-select completes.
  const captured = new URLSearchParams("?view=computers&room=r");
  const fn = vm.runInNewContext(`(id)=>{${body}}`, {
    URLSearchParams,
    window: { location: { search: actualSearch } },
    hasRouteBoundIntent: () => blocked,
    setParams: (update) => {
      navigated = update(captured);
    },
  });
  fn("host-a");
  return navigated;
}
test("late computer auto-selection cannot replace a newer destination", () => {
  assert.equal(select("?view=tasks&room=r"), undefined);
});
test("computer selection retains current route fields and the write-intent fence", () => {
  assert.equal(
    select("?view=computers&room=r").toString(),
    "view=computers&room=r&computer=host-a",
  );
  assert.equal(select("?view=computers", true), undefined);
});
