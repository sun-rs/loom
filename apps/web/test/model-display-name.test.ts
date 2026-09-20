import assert from "node:assert/strict";
import test from "node:test";
import { modelDisplayName } from "../src/model-display-name.ts";
import { runtimeProfilePresentation } from "../src/agent-runtime-presentation.ts";
test("one presentation name covers catalog, profile and historical model IDs", () => {
  assert.equal(
    modelDisplayName({ modelId: "local:codex-cli/v1:gpt-5.6-luna" }),
    "GPT-5.6-Luna",
  );
  assert.equal(
    modelDisplayName({ modelId: "sonnet" }, "claude"),
    "Claude Sonnet",
  );
  assert.equal(
    modelDisplayName({ modelId: "claude-sonnet-5" }, "claude"),
    "Claude Sonnet 5",
  );
  assert.equal(
    modelDisplayName({ modelId: "aihubmix/deepseek-v4.1-flash" }, "opencode"),
    "Aihubmix · DeepSeek-V4.1-Flash",
  );
  assert.equal(
    modelDisplayName({ modelId: "kimi-code/k3" }, "kimi"),
    "Kimi-Code · K3",
  );
  assert.equal(
    modelDisplayName(
      { modelId: "gpt-5.6-luna", displayName: "GPT-5.6 Luna" },
      "codex",
    ),
    "GPT-5.6 Luna",
  );
  const binding = {
    modelBindingId: "binding",
    provider: "aihubmix",
    modelId: "aihubmix/deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
  };
  const runtime = {
    cliId: "opencode",
    executable: "opencode",
    modelBindingDescriptors: [binding],
  } as any;
  const view = runtimeProfilePresentation([runtime], {
    exactBindingIds: ["binding"],
  });
  assert.equal(view.modelLabel, "Aihubmix · DeepSeek V4.1 Flash");
  assert.equal(view.modelId, "aihubmix/deepseek-v4.1-flash");
});
