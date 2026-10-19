import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("composer uses official toolbar label and send geometry without old font overrides", () => {
  const s = read("packages/web/src/components/message/MessageInput.tsx");
  assert.match(s, /<ComposerToolbarLabel/);
  assert.match(s, /<Send size=\{18\}/);
  assert.doesNotMatch(s, /data-tone="pink"|md:text-sm font-display/);
});
test("overflow uses native header body and panel actions instead of manually sized shell", () => {
  const s = read("packages/web/src/components/ui/OverflowSheet.tsx");
  for (const name of [
    "DrawerHeader",
    "DrawerBody",
    "PanelActions",
    "PanelAction",
  ])
    assert.ok(s.includes("<" + name));
  assert.doesNotMatch(
    s,
    /max-w-\[min\(100vw,34rem\)\]|grid-cols-\[auto_minmax/,
  );
  assert.ok(s.includes("eventDetails.cancel()"));
});
test("task toolbar lets native segmented items own the state and avoids old page icon", () => {
  const s = read("loom/TasksPage.tsx");
  assert.match(s, /<TaskFilters/);
  assert.match(
    readFileSync(
      new URL(
        "../../frontends/raft/loom/TaskFilterPicker.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    /<PickerTriggerButton/,
  );
  assert.match(s, /<PanelTitle/);
  assert.doesNotMatch(s, /variant=\{mode === value/);
});

test("mobile composer does not override native button geometry and glyphs", () => {
  const s = read("loom/mobile.css");
  assert.ok(!s.includes("width: 28px"));
  assert.ok(!s.includes("width: 14px"));
});
