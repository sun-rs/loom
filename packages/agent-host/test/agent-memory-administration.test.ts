import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import {
  inspectAgentMemoryWorkspace,
  prepareAgentMemoryWorkspace,
  readAgentMemoryWorkspaceFile,
} from "../src/index.ts";

function agent(): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: "definition-admin",
      agentDefinitionRevisionId: "revision-admin",
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      displayName: "Admin Agent",
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"2".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: "Memory administration fixture",
      skillRefs: [],
    },
    handle: "admin-agent",
    participantId: "agent-admin",
    schemaVersion: 1,
  };
}

test("Computer exposes a bounded, path-free Agent Memory tree and safe file reads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-admin-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    assert.deepEqual(
      await inspectAgentMemoryWorkspace({
        ownerParticipantId: "agent-admin",
        rootDirectory,
      }),
      {
        files: [],
        ownerParticipantId: "agent-admin",
        schemaVersion: 1,
        state: "absent",
        thresholdBytes: 65_536,
      },
    );

    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    writeFileSync(prepared.memoryIndexPath, "# Admin Agent\n- durable\n");
    writeFileSync(
      join(prepared.notesPath, "domain.md"),
      "# Domain\nRoom first\n",
      {
        mode: 0o600,
      },
    );

    const snapshot = await inspectAgentMemoryWorkspace({
      ownerParticipantId: "agent-admin",
      rootDirectory,
    });
    assert.equal(snapshot.state, "ready");
    assert.deepEqual(
      snapshot.files.map((file) => file.relativePath),
      ["MEMORY.md", "notes/domain.md"],
    );
    assert.equal(JSON.stringify(snapshot).includes(directory), false);
    if (snapshot.state === "ready") {
      assert.equal(snapshot.indexOverThreshold, false);
      assert.equal(snapshot.noteCount, 1);
    }

    const read = await readAgentMemoryWorkspaceFile({
      ownerParticipantId: "agent-admin",
      relativePath: "notes/domain.md",
      rootDirectory,
    });
    assert.equal(read.content, "# Domain\nRoom first\n");
    assert.equal(read.file.relativePath, "notes/domain.md");
    await assert.rejects(
      readAgentMemoryWorkspaceFile({
        ownerParticipantId: "agent-admin",
        relativePath: "../outside",
        rootDirectory,
      }),
      /relative path/iu,
    );

    const outside = join(directory, "outside.txt");
    writeFileSync(outside, "outside");
    await symlink(outside, join(prepared.notesPath, "escape.md"));
    await assert.rejects(
      inspectAgentMemoryWorkspace({
        ownerParticipantId: "agent-admin",
        rootDirectory,
      }),
      /symbolic/iu,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
