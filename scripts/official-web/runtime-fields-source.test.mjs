import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("Role create and edit delegate runtime fields to the official renderer", () => {
  const editor = readFileSync("frontends/raft/loom/RoleEditor.tsx", "utf8");
  assert.match(editor, /<RoleRuntimeFields/);
  assert.doesNotMatch(editor, /label="推理强度"/);
  const adapter = readFileSync(
    "frontends/raft/loom/RoleRuntimeFields.tsx",
    "utf8",
  );
  assert.match(adapter, /RuntimeFormV2Fields/);
  assert.match(adapter, /applyRuntimeFormV2Change/);
});

test("adopted runtime renderer functions remain exact upstream source", async () => {
  const ts = (await import("typescript")).default;
  const base = "frontends/raft/upstream/published-2026-10-22/runtime-form/";
  const original = readFileSync(base + "RuntimeConfigFields.tsx", "utf8");
  const local = readFileSync(
    "frontends/raft/packages/web/src/components/agent/RuntimeConfigFields.tsx",
    "utf8",
  );
  const functionText = (source, name) =>
    ts
      .createSourceFile("s.tsx", source, 99, true, 4)
      .statements.find(
        (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
      )
      ?.getText();
  for (const name of [
    "RuntimeFormV2Fields",
    "RuntimeDisclosureToggle",
    "RuntimeFormV2StringMapField",
    "RuntimeSelectControl",
    "RuntimeEnvVarsField",
  ]) {
    assert.ok(functionText(original, name));
    assert.equal(functionText(local, name), functionText(original, name), name);
  }
});
