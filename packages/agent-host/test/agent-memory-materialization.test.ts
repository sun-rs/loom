import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentRuntimeContext } from "@rah-os/protocol";

import {
  inspectAgentMemoryWorkspace,
  materializeAgentMemoryForRun,
  prepareAgentMemoryWorkspace,
  prepareAgentMemoryRun,
  readAgentMemoryMaterializationReceipt,
  readAgentMemoryWorkspaceFile,
} from "../src/index.ts";
import { agentMemoryMaterializationReceiptPath } from "../src/agent-memory-materialization.ts";

function agent(): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: "definition-alice",
      agentDefinitionRevisionId: "revision-alice-1",
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      displayName: "Alice",
      executionPolicyRevisionId: "execution-full-access-v1",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"2".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: "Keeps private memory across Rooms",
      skillRefs: [],
    },
    handle: "alice",
    participantId: "agent-alice",
    schemaVersion: 1,
  };
}

const activation = (runAttemptId: string) => ({
  activationId: `activation-${runAttemptId}`,
  computerHostId: "computer-local",
  roomId: "room-design",
  runAttemptId,
});

test("bootstrap accepts UTF-8 BOM without rewriting canonical memory bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-bom-"));
  const rootDirectory = join(directory, "memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    const source =
      "\uFEFF# Alice\n## Key Knowledge\n- Durable → notes/decision.md\n";
    writeFileSync(prepared.memoryIndexPath, source);
    const run = await prepareAgentMemoryRun({
      agent: agent(),
      rootDirectory,
      prepared,
      activation: activation("bom"),
      bootstrapMode: "verbatim_inline",
    });
    const view = JSON.parse(run.env.RAH_AGENT_MEMORY_BOOTSTRAP_JSON!);
    assert.equal(view.text, source);
    assert.equal(readFileSync(prepared.memoryIndexPath, "utf8"), source);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap fails closed when index bytes change after materialization or are invalid UTF-8", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-view-race-"));
  const rootDirectory = join(directory, "memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    await assert.rejects(
      prepareAgentMemoryRun({
        agent: agent(),
        rootDirectory,
        prepared,
        activation: activation("changed"),
        now: () => {
          writeFileSync(
            prepared.memoryIndexPath,
            "# Changed after receipt snapshot\n- A different fact\n",
          );
          return Date.now();
        },
      }),
      /bootstrap source differs/u,
    );
    writeFileSync(prepared.memoryIndexPath, Buffer.from([0xff, 0xfe]));
    await assert.rejects(
      prepareAgentMemoryRun({
        agent: agent(),
        rootDirectory,
        prepared,
        activation: activation("binary"),
      }),
      /require UTF-8/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Computer writes a private index-only RunAttempt receipt without claiming notes coverage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-materialize-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    writeFileSync(prepared.memoryIndexPath, "# Alice\n- durable fact\n");
    writeFileSync(
      join(prepared.notesPath, "decisions.md"),
      "# Decisions\n- use a room-first ledger\n",
      { mode: 0o600 },
    );

    const receipt = await materializeAgentMemoryForRun({
      activation: activation("attempt-1"),
      agent: agent(),
      prepared,
      rootDirectory,
      now: () => Date.parse("2026-08-30T12:00:00.000Z"),
    });

    assert.equal(receipt.runAttemptId, "attempt-1");
    assert.equal(receipt.ownerParticipantId, "agent-alice");
    assert.equal(receipt.proofScope, "computer_materialized_not_model_read");
    assert.equal(receipt.schemaVersion, 2);
    assert.ok("coverage" in receipt && receipt.coverage === "index_only");
    assert.equal("snapshotDigest" in receipt, false);
    assert.deepEqual(
      receipt.files.map((file) => file.relativePath),
      ["MEMORY.md"],
    );
    assert.equal(JSON.stringify(receipt).includes(directory), false);
    assert.equal(
      receipt.files.every((file) => file.contentDigest.startsWith("sha256:")),
      true,
    );
    const inspection = await inspectAgentMemoryWorkspace({
      ownerParticipantId: agent().participantId,
      rootDirectory,
    });
    assert.deepEqual(
      inspection.files.map((file) => file.relativePath),
      ["MEMORY.md", "notes/decisions.md"],
      "explicit inspection still covers notes",
    );

    const reloaded = await readAgentMemoryMaterializationReceipt({
      rootDirectory,
      runAttemptId: "attempt-1",
    });
    assert.deepEqual(reloaded, receipt);
    const receiptDirectory = join(rootDirectory, ".materialization-receipts");
    const [receiptName] = readdirSync(receiptDirectory);
    assert.ok(receiptName);
    const receiptFile = readFileSync(
      join(receiptDirectory, receiptName),
      "utf8",
    );
    assert.match(receiptFile, /computer_materialized_not_model_read/u);
    assert.equal(lstatSync(receiptDirectory).mode & 0o077, 0);
    assert.equal(
      lstatSync(join(receiptDirectory, receiptName)).mode & 0o077,
      0,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("one RunAttempt cannot silently rematerialize a different memory index", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-rematerialize-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    await materializeAgentMemoryForRun({
      activation: activation("attempt-fixed"),
      agent: agent(),
      prepared,
      rootDirectory,
    });
    writeFileSync(prepared.memoryIndexPath, "# Alice\n- changed later\n");
    await assert.rejects(
      materializeAgentMemoryForRun({
        activation: activation("attempt-fixed"),
        agent: agent(),
        prepared,
        rootDirectory,
      }),
      /different memory index/iu,
    );

    const next = await materializeAgentMemoryForRun({
      activation: activation("attempt-next"),
      agent: agent(),
      prepared,
      rootDirectory,
    });
    assert.notEqual(
      next.files[0]!.contentDigest,
      (
        await readAgentMemoryMaterializationReceipt({
          rootDirectory,
          runAttemptId: "attempt-fixed",
        })
      )?.files[0]!.contentDigest,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("startup does not inspect unrelated notes, but explicit reads reject links and linked ancestors", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-note-link-"));
  const rootDirectory = join(directory, "agent-memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    const outside = join(directory, "outside.txt");
    writeFileSync(outside, "not Agent memory");
    await mkdir(join(prepared.notesPath, "nested"), { mode: 0o700 });
    await symlink(outside, join(prepared.notesPath, "nested", "escape.md"));

    const receipt = await materializeAgentMemoryForRun({
      activation: activation("attempt-link"),
      agent: agent(),
      prepared,
      rootDirectory,
    });
    assert.equal(receipt.files.length, 1);
    await assert.rejects(
      readAgentMemoryWorkspaceFile({
        rootDirectory,
        ownerParticipantId: agent().participantId,
        relativePath: "notes/nested/escape.md",
      }),
      /symbolic|regular file/iu,
    );
    const external = join(directory, "external");
    await mkdir(external, { mode: 0o700 });
    writeFileSync(join(external, "safe-looking.md"), "outside memory", {
      mode: 0o600,
    });
    await symlink(external, join(prepared.notesPath, "linked-directory"));
    await assert.rejects(
      readAgentMemoryWorkspaceFile({
        rootDirectory,
        ownerParticipantId: agent().participantId,
        relativePath: "notes/linked-directory/safe-looking.md",
      }),
      /directory|symbolic/iu,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("startup opens zero notes and enumerates zero notes directories, even beyond the audit file limit", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-no-scan-"));
  const rootDirectory = join(directory, "memory");
  const prepared = await prepareAgentMemoryWorkspace({
    agent: agent(),
    rootDirectory,
  });
  try {
    for (let i = 0; i < 4_100; i++) {
      writeFileSync(
        join(prepared.notesPath, `${i}.md`),
        `unrelated note ${i}`,
        { mode: 0o600 },
      );
    }
    const opened: string[] = [];
    const createReadStream = fs.createReadStream;
    const streamMock = t.mock.method(
      fs,
      "createReadStream",
      (...args: Parameters<typeof createReadStream>) => {
        opened.push(String(args[0]));
        assert.equal(
          String(args[0]).startsWith(`${prepared.notesPath}/`),
          false,
          "startup must not open note content",
        );
        return createReadStream(...args);
      },
    );
    const directoryMock = t.mock.method(fsPromises, "opendir", () => {
      throw new Error("startup must not enumerate notes");
    });
    syncBuiltinESMExports();
    try {
      const first = await prepareAgentMemoryRun({
        agent: agent(),
        rootDirectory,
        activation: activation("no-scan"),
      });
      writeFileSync(
        join(prepared.notesPath, "0.md"),
        "changed outside this receipt's coverage",
      );
      const retry = await prepareAgentMemoryRun({
        agent: agent(),
        rootDirectory,
        activation: activation("no-scan"),
      });
      assert.deepEqual(
        retry.materializationReceipt,
        first.materializationReceipt,
      );
      assert.ok(opened.length > 0);
      assert.ok(opened.every((path) => path === prepared.memoryIndexPath));
      assert.equal(directoryMock.mock.callCount(), 0);
    } finally {
      streamMock.mock.restore();
      directoryMock.mock.restore();
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("legacy full-tree receipts remain readable and immutable, but are not silently revalidated as index-only", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-legacy-"));
  const rootDirectory = join(directory, "memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    writeFileSync(join(prepared.notesPath, "old.md"), "old note", {
      mode: 0o600,
    });
    const inspection = await inspectAgentMemoryWorkspace({
      rootDirectory,
      ownerParticipantId: agent().participantId,
    });
    const digest = (value: string) =>
      `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const snapshotDigest = digest(
      JSON.stringify(
        inspection.files.map(({ bytes, contentDigest, relativePath }) => ({
          bytes,
          contentDigest,
          relativePath,
        })),
      ),
    );
    const legacy = {
      ...activation("legacy"),
      agentDefinitionRevisionId:
        agent().agentDefinitionRevision.agentDefinitionRevisionId,
      files: inspection.files,
      materializedAt: "2026-08-30T12:00:00.000Z",
      memoryPolicyRef: agent().agentDefinitionRevision.memoryPolicyRef,
      ownerParticipantId: agent().participantId,
      proofScope: "computer_materialized_not_model_read",
      receiptId: digest(
        [
          "computer-local",
          "legacy",
          agent().participantId,
          snapshotDigest,
        ].join("\n"),
      ),
      schemaVersion: 1,
      snapshotDigest,
    };
    await mkdir(join(rootDirectory, ".materialization-receipts"), {
      mode: 0o700,
    });
    const receiptPath = agentMemoryMaterializationReceiptPath(
      rootDirectory,
      "legacy",
    );
    const encoded = `${JSON.stringify(legacy)}\n`;
    writeFileSync(receiptPath, encoded, { mode: 0o600 });
    assert.deepEqual(
      await readAgentMemoryMaterializationReceipt({
        rootDirectory,
        runAttemptId: "legacy",
      }),
      legacy,
    );
    await assert.rejects(
      materializeAgentMemoryForRun({
        agent: agent(),
        rootDirectory,
        prepared,
        activation: activation("legacy"),
      }),
      /legacy.*new RunAttempt/iu,
    );
    assert.equal(readFileSync(receiptPath, "utf8"), encoded);
    const next = await materializeAgentMemoryForRun({
      agent: agent(),
      rootDirectory,
      prepared,
      activation: activation("new"),
    });
    assert.equal(next.schemaVersion, 2);
    assert.equal(
      readFileSync(join(prepared.notesPath, "old.md"), "utf8"),
      "old note",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("index-only startup still fences the owner, identity, policy and private root", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-memory-index-fences-"));
  const rootDirectory = join(directory, "memory");
  try {
    const prepared = await prepareAgentMemoryWorkspace({
      agent: agent(),
      rootDirectory,
    });
    const input = {
      agent: agent(),
      rootDirectory,
      prepared,
      activation: activation("fenced"),
    };
    await materializeAgentMemoryForRun(input);
    for (const key of ["roomId", "activationId", "computerHostId"] as const) {
      await assert.rejects(
        materializeAgentMemoryForRun({
          ...input,
          activation: { ...input.activation, [key]: "other" },
        }),
        /different memory/iu,
      );
    }
    const otherPolicy = {
      ...agent(),
      agentDefinitionRevision: {
        ...agent().agentDefinitionRevision,
        memoryPolicyRef: {
          ...agent().agentDefinitionRevision.memoryPolicyRef,
          versionId: "other-policy-version",
        },
      },
    };
    await assert.rejects(
      materializeAgentMemoryForRun({ ...input, agent: otherPolicy }),
      /different memory/iu,
    );
    await assert.rejects(
      materializeAgentMemoryForRun({
        ...input,
        agent: { ...agent(), participantId: "another-agent" },
        activation: activation("wrong-owner"),
      }),
      /owner/iu,
    );
    fs.chmodSync(rootDirectory, 0o755);
    await assert.rejects(
      materializeAgentMemoryForRun({
        ...input,
        activation: activation("unsafe-root"),
      }),
      /private/iu,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
