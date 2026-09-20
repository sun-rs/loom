import assert from "node:assert/strict";
import test from "node:test";
import { chatModelIdentifier } from "../src/chat-model-identifier.ts";

test("chat identifiers preserve native model IDs without adding provider metadata", () => {
  for (const provider of [
    "deepseek",
    "aihubmix",
    "openai",
    "anthropic",
    "kimi-code",
    "xai",
  ]) {
    assert.equal(
      chatModelIdentifier({ provider, modelId: "deepseek-v4-flash" }),
      "deepseek-v4-flash",
    );
  }
});
test("absent providers retain the model ID; qualified IDs never duplicate their provider", () => {
  assert.equal(chatModelIdentifier({ modelId: "sonnet" }), "sonnet");
  assert.equal(
    chatModelIdentifier({ provider: "  ", modelId: " gpt-5.6 " }),
    "gpt-5.6",
  );
  assert.equal(
    chatModelIdentifier({
      provider: " deepseek ",
      modelId: " deepseek/deepseek-v4-flash ",
    }),
    "deepseek/deepseek-v4-flash",
  );
  assert.equal(
    chatModelIdentifier({
      provider: "router",
      modelId: "deepseek/deepseek-v4-flash",
    }),
    "deepseek/deepseek-v4-flash",
  );
});

test("catalog-unavailable bindings use the same chat model ID as live agents", () => {
  for (const [runtime, modelId] of [
    ["codex-app-server/v1", "gpt-5.6"],
    ["claude-code/v1", "sonnet"],
    ["opencode-cli/v1", "iiiiitoken/gemini-3.8-flash-high"],
    ["kimi-cli/v1", "kimi-code/k3"],
  ]) {
    assert.equal(
      chatModelIdentifier({ modelId: `local:${runtime}:${modelId}` }),
      chatModelIdentifier({ modelId }),
    );
  }
  assert.equal(
    chatModelIdentifier({ modelId: "vendor:model:variant" }),
    "vendor:model:variant",
  );
});

test("adapter provider metadata never prefixes Codex and Claude native IDs", () => {
  assert.equal(
    chatModelIdentifier({ provider: "openai", modelId: "gpt-5.6" }),
    "gpt-5.6",
  );
  assert.equal(
    chatModelIdentifier({ provider: "anthropic", modelId: "sonnet" }),
    "sonnet",
  );
});
