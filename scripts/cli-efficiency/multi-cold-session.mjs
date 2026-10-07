// Read existing owners only; never adopt a legacy record or create a session.
import assert from "node:assert/strict";
import { join } from "node:path";
import { ProviderSessionStore } from "@rah-os/agent-host";
export async function readColdSessionEvidence({
  stateDirectory,
  provider,
  participantId,
  roomId,
  sessionState,
  runs,
  expectedGeneration,
}) {
  const protocol = { claude: "claude-stream-json/v1", kimi: "kimi-acp/v1" }[
    provider
  ];
  assert.ok(protocol, "Unsupported cold provider");
  assert.ok(
    sessionState &&
      sessionState.instance_id === participantId &&
      sessionState.bound === 1,
    "Missing exact durable session binding",
  );
  assert.ok(
    Number.isSafeInteger(sessionState.generation) &&
      sessionState.generation >= 0,
  );
  assert.equal(
    sessionState.generation,
    expectedGeneration,
    "Session generation changed",
  );
  assert.ok(
    runs.some(
      (r) =>
        r.runAttemptId === sessionState.bound_run_attempt_id &&
        r.participantId === participantId &&
        r.roomId === roomId,
    ),
    "Binding Run belongs to another participant or Room",
  );
  const scope =
    sessionState.generation === 0
      ? "instance-session/v1"
      : `instance-session/v1:generation:${sessionState.generation}`;
  const store = new ProviderSessionStore({
    rootDirectory: join(stateDirectory, "supervisors/provider-sessions"),
  });
  // Loading the exact stable key bypasses the store's optional legacy-adoption path.
  const record = await store.load({
    participantId,
    provider: protocol,
    runtimeProfileRevisionId: scope,
    workspaceMountRevisionId: scope,
  });
  assert.ok(record?.providerSessionId, "Missing exact provider session record");
  return {
    participantId,
    provider: protocol,
    generation: sessionState.generation,
    sessionId: record.providerSessionId,
    boundRunAttemptId: sessionState.bound_run_attempt_id,
    recordedAt: record.recordedAt,
  };
}
