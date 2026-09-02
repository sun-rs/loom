import assert from "node:assert/strict";
import test from "node:test";
import pack from "@rah-os/ui-tokens/avatar-pack.json" with { type: "json" };
import { agentAvatarPixels } from "../src/agent-avatar-presentation.ts";
test("every avatar, including legacy random identities, renders an unchanged official preset", () => {
  const values = Object.values(pack.presets).map((value) =>
    JSON.stringify(value),
  );
  for (const key of [
    "codex",
    "claude",
    "kimi",
    "opencode",
    "random:abc",
    "not-a-preset",
    undefined,
  ])
    assert.ok(
      values.includes(JSON.stringify(agentAvatarPixels(key, "agent-1"))),
    );
  for (const [key, value] of Object.entries(pack.presets))
    assert.deepEqual(agentAvatarPixels(key), value);
});
