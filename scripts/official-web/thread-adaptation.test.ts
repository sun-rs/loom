import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adaptThreadItem,
  adaptThreadFooter,
  adaptComposerSubmit,
} from "../../frontends/raft/loom/thread-adaptation.ts";
test("controlled thread entry preserves all non-thread readonly guards and requires exact upstream boundaries", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const result = adaptThreadItem(source);
  assert.ok(result.includes("onOpenThread && !hideThreadActions"));
  for (const guard of [
    "onContextMenu={readOnlyProjection ? undefined : handleContextMenu}",
    "onReactionClick={handleReactionClick}",
    "readOnlyProjection ? undefined : handleOpenTaskRef",
  ])
    assert.ok(result.includes(guard));
  assert.throws(() => adaptThreadItem("wrong upstream"));
});
test("native readonly thread gains only a caller-owned footer slot", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/ThreadPanel.tsx",
    "utf8",
  );
  const result = adaptThreadFooter(source);
  assert.ok(result.includes("{loomFooter}"));
  assert.equal(result.split("{loomFooter}").length, 2);
  assert.throws(() => adaptThreadFooter("wrong upstream"));
});

test("Loom composer preserves IME and Shift guards while applying Enter send to touch", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageInput.tsx",
    "utf8",
  );
  const result = adaptComposerSubmit(source);
  assert.ok(
    result.includes('if (!onSendOverride && typeof window !== "undefined"'),
  );
  assert.ok(result.includes("if (e.shiftKey) return;"));
  assert.ok(result.includes("e.nativeEvent.isComposing"));
  assert.throws(() => adaptComposerSubmit("changed upstream"));
});
test("controlled task thread uses the native parent slot without repeating its root message", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/ThreadPanel.tsx",
    "utf8",
  );
  const result = adaptThreadFooter(source);
  assert.ok(
    result.includes(
      "const parent = parentSlot ?? (hideParentMessage ? null : (",
    ),
  );
});

test("controlled thread forwards native parent and reply profile actions to its host", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/ThreadPanel.tsx",
    "utf8",
  );
  const result = adaptThreadFooter(source);
  assert.equal(result.split("onOpenProfile={loomOnOpenProfile}").length, 3);
});
