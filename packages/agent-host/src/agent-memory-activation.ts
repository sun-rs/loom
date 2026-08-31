import { createHash } from "node:crypto";

import type {
  AgentMemoryMaterializationReceipt,
  AgentRuntimeContext,
} from "@rah-os/protocol";

import {
  buildAgentMemoryBootstrap,
  RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV,
  type AgentMemoryBootstrapMode,
} from "./agent-memory-bootstrap.ts";
import {
  AGENT_MEMORY_MAX_READ_BYTES,
  agentMemoryMaterializationReceiptPath,
  materializeAgentMemoryForRun,
  readAgentMemoryWorkspaceFile,
  type AgentMemoryMaterializationIdentity,
} from "./agent-memory-materialization.ts";
import {
  prepareAgentMemoryWorkspace,
  type PreparedAgentMemoryWorkspace,
} from "./agent-memory-workspace.ts";
import {
  prepareAgentMemoryRunSource,
  RAH_AGENT_MEMORY_SOURCE_FILE_ENV,
} from "./agent-memory-project.ts";

export type PreparedAgentMemoryActivation = PreparedAgentMemoryWorkspace &
  Readonly<{ materializationReceipt: AgentMemoryMaterializationReceipt }>;

/** One owner shared by local, remote and compatibility Runtime composition. */
export async function prepareAgentMemoryRun(input: {
  activation: AgentMemoryMaterializationIdentity;
  agent: AgentRuntimeContext;
  now?: () => number;
  prepared?: PreparedAgentMemoryWorkspace;
  rootDirectory: string;
  executionCwd?: string;
  /** Explicit opt-in only; production composition defaults to Raft original. */
  bootstrapMode?: AgentMemoryBootstrapMode;
}): Promise<PreparedAgentMemoryActivation> {
  const prepared = input.prepared ?? (await prepareAgentMemoryWorkspace(input));
  const runSource =
    input.executionCwd === undefined
      ? undefined
      : await prepareAgentMemoryRunSource({
          rootDirectory: input.rootDirectory,
          cwd: input.executionCwd,
        });
  const materializationReceipt = await materializeAgentMemoryForRun({
    ...input,
    prepared,
    ...(runSource === undefined ? {} : { source: runSource }),
  });
  const index = materializationReceipt.files[0]!;
  let source: string | null = null;
  if (index.bytes <= AGENT_MEMORY_MAX_READ_BYTES) {
    const read = await readAgentMemoryWorkspaceFile({
      ownerParticipantId: input.agent.participantId,
      relativePath: "MEMORY.md",
      rootDirectory: input.rootDirectory,
    });
    // Check the bytes actually returned, not only stat/hash observations made
    // before/after them. The view must describe this Run's observed index,
    // not pretend the uninspected notes form a verified tree snapshot.
    const digest = `sha256:${createHash("sha256").update(read.content, "utf8").digest("hex")}`;
    if (
      digest !== index.contentDigest ||
      read.file.contentDigest !== index.contentDigest ||
      read.file.modifiedAt !== index.modifiedAt
    ) {
      throw new Error(
        "Agent memory bootstrap source differs from RunAttempt materialization",
      );
    }
    source = read.content;
  }
  return Object.freeze({
    ...prepared,
    env: Object.freeze({
      ...prepared.env,
      [RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV]: buildAgentMemoryBootstrap(
        source,
        runSource?.resolution === "matched" ? runSource.project : undefined,
        {
          ...(input.bootstrapMode === undefined
            ? {}
            : { mode: input.bootstrapMode }),
          ...(runSource === undefined
            ? {}
            : { projectResolution: runSource.resolution }),
        },
      ),
      ...(runSource === undefined
        ? {}
        : {
            [RAH_AGENT_MEMORY_SOURCE_FILE_ENV]:
              agentMemoryMaterializationReceiptPath(
                input.rootDirectory,
                input.activation.runAttemptId,
              ),
          }),
    }),
    materializationReceipt,
  });
}
