import assert from "node:assert/strict";
import test from "node:test";
import { chatModelIdentifier } from "../src/chat-model-identifier.ts";

test("chat identifiers use raw model IDs and any supplied provider", () => {
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
      `${provider}/deepseek-v4-flash`,
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
    "router/deepseek/deepseek-v4-flash",
  );
});
