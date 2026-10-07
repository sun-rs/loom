import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderSessionStore } from "@rah-os/agent-host";
import { readColdSessionEvidence } from "./multi-cold-session.mjs";
test("cold session evidence uses the persisted exact participant/provider/generation binding without warm runtime rows", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-cold-binding-"));
  try {
    const store = new ProviderSessionStore({
      rootDirectory: join(root, "supervisors/provider-sessions"),
    });
    const key = {
      participantId: "a",
      provider: "claude-stream-json/v1",
      runtimeProfileRevisionId: "original",
      workspaceMountRevisionId: "original",
    };
    await store.record(key, "native-same", {
      instance: true,
      instanceGeneration: 0,
    });
    const input = {
      stateDirectory: root,
      provider: "claude",
      participantId: "a",
      roomId: "room",
      sessionState: {
        instance_id: "a",
        generation: 0,
        bound: 1,
        bound_run_attempt_id: "first",
      },
      runs: [{ runAttemptId: "first", participantId: "a", roomId: "room" }],
      expectedGeneration: 0,
    };
    const p = await readColdSessionEvidence(input);
    assert.equal(p.sessionId, "native-same");
    assert.equal(p.generation, 0);
    for (const bad of [
      { provider: "kimi" },
      { participantId: "b" },
      { expectedGeneration: 1 },
      { sessionState: { ...input.sessionState, bound: 0 } },
      { runs: [{ ...input.runs[0], participantId: "other" }] },
    ])
      await assert.rejects(readColdSessionEvidence({ ...input, ...bad }));
    await store.record(key, "native-new", {
      instance: true,
      instanceGeneration: 1,
    });
    const next = await readColdSessionEvidence({
      ...input,
      expectedGeneration: 1,
      sessionState: { ...input.sessionState, generation: 1 },
    });
    assert.equal(next.sessionId, "native-new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
