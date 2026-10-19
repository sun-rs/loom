import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = () =>
  readFileSync("frontends/raft/loom/ComputerProfile.tsx", "utf8");
test("computer editor preserves native keyboard entry points, with IME and unresolved-write guards", () => {
  const s = source();
  assert.match(s, /onKeyDown=\{handleKeyDown\}/);
  assert.match(s, /nativeEvent.isComposing/);
  assert.match(s, /keyCode === 229/);
  assert.match(s, /event.metaKey \|\| event.ctrlKey/);
  assert.match(s, /event.key === "Escape"/);
  assert.match(s, /writes.state !== "idle"/);
});
test("computer description keeps official resize/counter and edit tooltip composition", () => {
  const s = source();
  assert.match(s, /<Tooltip/);
  assert.match(s, /min-h-20 w-full resize-y/);
  assert.match(s, /\{value.length\}\/500/);
  assert.match(s, /flex items-center justify-between gap-2/);
});
