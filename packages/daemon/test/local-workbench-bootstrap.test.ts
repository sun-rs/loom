import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RuntimeProfileRegistry } from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";

import {
  prepareLocalWorkbench,
  type LocalWorkbenchRuntimeSpec,
} from "../src/local-workbench-bootstrap.ts";

test("local workbench bootstrap is persistent, owner-private, and restart-safe", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-local-workbench-"));
  const stateDirectory = join(parent, "state");
  const workspaceCwd = join(parent, "workspace");
  mkdirSync(workspaceCwd);
  const spec = fakeRuntimeSpec(workspaceCwd);
  try {
    const first = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    assert.equal(statSync(stateDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(first.humanSecretPath).mode & 0o777, 0o600);
    assert.equal(statSync(first.hostSecretPath).mode & 0o777, 0o600);
    assert.equal(first.config.workspace.cwd, workspaceCwd);
    assert.deepEqual(first.config.host.participantIds, [
      first.metadata.bootstrapParticipantIds[0],
    ]);

    const kernel = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    kernel.initialize();
    const human = kernel.authenticateHumanAccessToken(first.humanAccessToken);
    kernel.postMessage(human, {
      body: "persistent message",
      idempotencyKey: "restart-proof-message",
      recipients: [],
      roomId: first.metadata.defaultRoomId,
    });
    assert.equal(
      kernel.listAgentCatalog(human, {
        controlRoomId: first.metadata.controlRoomId,
      })[0]?.currentRevision.instructions,
      spec.instructions,
    );
    kernel.close();

    const second = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    assert.deepEqual(second.metadata, first.metadata);
    assert.equal(second.humanAccessToken, first.humanAccessToken);
    assert.equal(second.hostAccessToken, first.hostAccessToken);

    const reopened = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    reopened.initialize();
    const reopenedHuman = reopened.authenticateHumanAccessToken(
      second.humanAccessToken,
    );
    assert.equal(
      reopened.listMessages(reopenedHuman, {
        roomId: second.metadata.defaultRoomId,
      }).messages[0]?.body,
      "persistent message",
    );
    assert.deepEqual(
      reopened.authenticateHostAccessToken(second.hostAccessToken)
        .participantIds,
      second.metadata.bootstrapParticipantIds,
    );
    reopened.close();

    const registry = new RuntimeProfileRegistry({
      databasePath: second.registryDatabasePath,
      hostId: second.metadata.hostId,
    });
    registry.initialize();
    assert.equal(
      registry.getActiveRevision(spec.runtimeProfileId)?.manifest.adapter
        .executable,
      process.execPath,
    );
    assert.equal(registry.listRevisions(spec.runtimeProfileId).length, 1);
    registry.close();

    await assert.rejects(
      prepareLocalWorkbench({
        runtimeSpecs: [spec],
        stateDirectory,
        workspaceCwd: join(parent, "different-workspace"),
      }),
      /belongs to workspace/u,
    );
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

function fakeRuntimeSpec(workspaceCwd: string): LocalWorkbenchRuntimeSpec {
  return {
    agentHandle: "TestAgent",
    args: ["--version"],
    avatarKey: "test-agent",
    cliId: "test",
    description: "A persistent fake Agent for bootstrap verification.",
    displayName: "Test Agent",
    executable: process.execPath,
    instructions: "Always prove persistence through canonical Room actions.",
    reasoning: "default",
    role: "Persistent test Agent",
    runtimeProfileId: "local-workbench-profile-test",
    workspaceCwd,
  };
}
