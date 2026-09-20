import assert from "node:assert/strict";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import {
  buildRaftCompatibleInitialMemory,
  inspectAgentMemoryIndex,
  prepareAgentMemoryWorkspace,
  RAH_AGENT_MEMORY_DIR_ENV,
  RAH_AGENT_MEMORY_INDEX_ENV,
} from "../src/agent-memory-workspace.ts";

function agent(
  participantId: string,
  displayName: string,
  role: string,
): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: `definition-${participantId}`,
      agentDefinitionRevisionId: `revision-${participantId}`,
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-29T12:00:00.000+08:00",
      createdBy: "human-owner",
      displayName,
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"2".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role,
      skillRefs: [],
    },
    handle: displayName.toLowerCase(),
    participantId,
    schemaVersion: 1,
  };
}

test("Raft-compatible Agent memory is private, per-Agent, and seeded only once", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-memory-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    const alice = await prepareAgentMemoryWorkspace({
      agent: agent("participant-alice", "Alice", "Research Agent"),
      rootDirectory,
    });
    assert.equal(alice.env[RAH_AGENT_MEMORY_INDEX_ENV], alice.memoryIndexPath);
    assert.equal(alice.env[RAH_AGENT_MEMORY_DIR_ENV], alice.workspacePath);
    assert.equal(lstatSync(rootDirectory).mode & 0o077, 0);
    assert.equal(lstatSync(alice.workspacePath).mode & 0o077, 0);
    assert.equal(lstatSync(alice.memoryIndexPath).mode & 0o077, 0);
    assert.equal(lstatSync(join(alice.workspacePath, "notes")).mode & 0o077, 0);
    assert.match(readFileSync(alice.memoryIndexPath, "utf8"), /^# Alice$/mu);
    assert.match(
      readFileSync(alice.memoryIndexPath, "utf8"),
      /^## Role\nResearch Agent$/mu,
    );

    writeFileSync(alice.memoryIndexPath, "# Alice\n\nDurable memory.\n");
    const changedDefinition = await prepareAgentMemoryWorkspace({
      agent: agent("participant-alice", "Alice v2", "Different model role"),
      rootDirectory,
    });
    assert.equal(changedDefinition.workspacePath, alice.workspacePath);
    assert.equal(
      readFileSync(changedDefinition.memoryIndexPath, "utf8"),
      "# Alice\n\nDurable memory.\n",
    );

    const cindy = await prepareAgentMemoryWorkspace({
      agent: agent("participant-cindy", "Cindy", "Onboarding Agent"),
      rootDirectory,
    });
    assert.notEqual(cindy.workspacePath, alice.workspacePath);
    assert.doesNotMatch(cindy.workspacePath, /participant-cindy/u);
    assert.match(readFileSync(cindy.memoryIndexPath, "utf8"), /^# Cindy$/mu);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the initial index and cleaner hint preserve the extracted Raft contract", async () => {
  assert.equal(
    buildRaftCompatibleInitialMemory({
      agentName: "Kimi",
      description: undefined,
    }),
    "# Kimi\n\n## Role\nNo role defined yet.\n\n## Key Knowledge\n- No notes yet.\n\n## Active Context\n- First startup.\n",
  );

  const directory = mkdtempSync(join(tmpdir(), "rah-agent-memory-size-"));
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent("participant-size", "Size", "Size Agent"),
      rootDirectory: join(directory, "agent-memory"),
    });
    writeFileSync(prepared.memoryIndexPath, "x".repeat(65_537));
    assert.deepEqual(await inspectAgentMemoryIndex(prepared.memoryIndexPath), {
      bytes: 65_537,
      kind: "over_threshold",
      summary: "Loaded each session; keep an index and move details to notes.",
      thresholdBytes: 65_536,
      title: "MEMORY.md is 64.0 KiB, over 64.0 KiB",
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Agent memory fails closed on an aliased owner directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-agent-memory-alias-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent("participant-alias", "Alias", "Alias Agent"),
      rootDirectory,
    });
    const original = `${prepared.workspacePath}.original`;
    const { rename } = await import("node:fs/promises");
    await rename(prepared.workspacePath, original);
    await symlink(original, prepared.workspacePath);
    await assert.rejects(
      () =>
        prepareAgentMemoryWorkspace({
          agent: agent("participant-alias", "Alias", "Alias Agent"),
          rootDirectory,
        }),
      /private|symbolic/u,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
