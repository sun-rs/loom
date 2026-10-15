import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  exposeAppearance,
  adaptMessageModelLabel,
} from "../../frontends/raft/loom/appearance-adaptation.ts";
test("appearance section is directly exported without rewriting its native UI or preferences", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/settings/SettingsPanel.tsx",
    "utf8",
  );
  assert.equal(
    exposeAppearance(source),
    source + "\nexport { AppearanceSection };\n",
  );
  assert.throws(() => exposeAppearance("changed upstream"));
});
test("model label uses authenticated Loom catalog while retaining the native preference gate", () => {
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageItem.tsx",
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
