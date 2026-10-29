import test from "node:test";
import assert from "node:assert/strict";
import { roleFormFrom, buildRoleConfiguration } from "../src/role-form.ts";
const config: any = {
  displayName: "Tom",
  handle: "tom",
  role: "Tom",
  instructions: "Only this is a prompt.",
  description: "A private note, not instructions.",
  avatarKey: "pixel:loom-gemini",
  runtimeOfferId: "offer",
  modelIntent: {
    fallback: "disabled",
    exactBindingIds: ["model"],
    reasoning: "low",
  },
};
const choices: any = [
  {
    runtimeOfferId: "offer",
    bindings: [{ modelBindingId: "model", label: "Model", reasoning: ["low"] }],
  },
];
test("Role description and avatar round-trip separately from prompt", () => {
  const form = roleFormFrom(config);
  assert.equal(form.description, config.description);
  assert.equal(form.avatarKey, config.avatarKey);
  const built = buildRoleConfiguration(
    { ...form, description: "New note" },
    choices,
    config,
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.value.description, "New note");
  assert.equal(built.value.instructions, config.instructions);
  assert.equal(built.value.avatarKey, config.avatarKey);
  const cleared = buildRoleConfiguration(
    { ...form, description: "" },
    choices,
    config,
  );
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.value.description, "");
});
