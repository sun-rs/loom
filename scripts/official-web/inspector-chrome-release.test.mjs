import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/loom/" + p, "utf8");
test("instance inspector adopts native tab wrapper and header dismissal action", () => {
  const s = read("InstanceInspector.tsx");
  assert.match(s, /<ConversationPanelTabs/);
  assert.doesNotMatch(s, /variant="underline"|CloseButton|<X size=\{14\}/);
  assert.match(s, /<PanelAction/);
  assert.match(s, /<PanelResizeHandle/);
  assert.match(s, /desktop &&/);
});
test("runtime overflow uses native PanelAction without a local button size recipe", () => {
  const s = read("RuntimeControl.tsx");
  assert.match(s, /<PanelAction/);
  assert.doesNotMatch(
    s,
    /size="icon-sm"|variant="outline"|<EllipsisVertical size=\{14\}/,
  );
});
