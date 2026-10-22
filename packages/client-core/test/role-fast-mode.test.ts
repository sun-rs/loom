import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoleConfiguration,
  roleFormFrom,
  type RuntimeChoice,
} from "../src/role-form.ts";
const choices: RuntimeChoice[] = [
  {
    runtimeOfferId: "cli",
    label: "CLI",
    bindings: [
      {
        label: "Model",
        modelBindingId: "binding",
        reasoning: ["low"],
        serviceTiers: ["default", "fast"],
      },
    ],
  },
];
const form = {
  displayName: "Role",
  handle: "role",
  instructions: "Work",
  role: "Role",
  runtimeOfferId: "cli",
  modelBindingId: "binding",
  reasoning: "low",
  serviceTier: "fast" as const,
};
test("Role Fast round-trips and cannot be saved to an unsupported binding", () => {
  const built = buildRoleConfiguration(form, choices);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.value.modelIntent.serviceTier, "fast");
  assert.equal(roleFormFrom(built.value).serviceTier, "fast");
  const unsupported = [
    {
      ...choices[0]!,
      bindings: [{ ...choices[0]!.bindings[0]!, serviceTiers: ["default"] }],
    },
  ];
  assert.equal(buildRoleConfiguration(form, unsupported).ok, false);
  const disabled = buildRoleConfiguration(
    { ...form, serviceTier: "default" },
    choices,
    built.value,
  );
  assert.equal(disabled.ok, true);
  if (disabled.ok)
    assert.equal(disabled.value.modelIntent.serviceTier, "default");
});
