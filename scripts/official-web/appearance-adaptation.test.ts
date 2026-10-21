import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adaptMessageModelLabel } from "../../frontends/raft/loom/appearance-adaptation.ts";
test("model label uses authenticated Loom catalog while retaining the native preference gate", () => {
  const source = readFileSync(
    "frontends/raft/upstream/raft-web-source/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const result = adaptMessageModelLabel(source);
  assert.ok(
    result.includes(
      "const loomModelLabel = useLoomModelLabel(message.senderId);",
    ),
  );
  assert.ok(result.includes("showAgentModelNameOption\n    ? loomModelLabel"));
  assert.throws(() => adaptMessageModelLabel("changed upstream"));
});
