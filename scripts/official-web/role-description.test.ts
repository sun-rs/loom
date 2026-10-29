import test from "node:test";
import assert from "node:assert/strict";
import {
  patchRoleDescription,
  rolePresentation,
} from "../../frontends/raft/loom/role-profile-values.ts";
test("single description/prompt save preserves legacy prompt, metadata and identity", () => {
  const config: any = {
    displayName: "Tom",
    handle: "tom",
    role: "Original preamble",
    instructions: "Do real work",
    description: "Old note",
    avatarKey: "pixel:heart",
    runtimeOfferId: "opaque",
    modelIntent: {
      exactBindingIds: ["model"],
      fallback: "disabled",
      reasoning: "low",
    },
  };
  assert.deepEqual(
    patchRoleDescription(
      config,
      "  New note  ",
      " Original preamble\n\nDo real work ",
    ),
    {
      ...config,
      role: "Tom",
      instructions: "Original preamble\n\nDo real work",
      description: "New note",
    },
  );
  const inventory: any = {
    runtimes: [
      {
        runtimeOfferId: "opaque",
        displayName: "Codex CLI",
        modelBindingDescriptors: [
          { modelBindingId: "model", displayName: "Model Name" },
        ],
      },
    ],
  };
  assert.deepEqual(rolePresentation(config, inventory), {
    description: "Old note",
    fallback: "Model Name · low",
    runtimeLabel: "Codex CLI",
  });
  assert.equal(
    rolePresentation({ ...config, description: "" }, inventory).description,
    "Model Name · low",
  );
  assert.equal(
    rolePresentation({ ...config, description: "" }, undefined).runtimeLabel,
    undefined,
    "opaque offer IDs are not a CLI binding",
  );
});
