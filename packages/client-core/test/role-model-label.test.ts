import test from "node:test";
import assert from "node:assert/strict";
import { roleModelLabel } from "../src/role-form.ts";
test("role model choices disambiguate identical display names without changing exact bindings", () => {
  const choices = [
    "aihubmix/deepseek-v4.1-flash",
    "deepseek/deepseek-flash",
  ].map((id) => ({
    label: "DeepSeek V4.1 Flash（local:opencode-cli/v1:" + id + "）",
    modelBindingId: "local:opencode-cli/v1:" + id,
    reasoning: ["low"],
  }));
  assert.equal(
    roleModelLabel(choices[0]!, choices),
    "DeepSeek V4.1 Flash · aihubmix/deepseek-v4.1-flash",
  );
  assert.equal(
    roleModelLabel(choices[1]!, choices),
    "DeepSeek V4.1 Flash · deepseek/deepseek-flash",
  );
  assert.equal(
    roleModelLabel(choices[0]!, [choices[0]!]),
    "DeepSeek V4.1 Flash",
  );
});
