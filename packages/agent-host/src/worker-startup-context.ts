import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  AgentRuntimeContextSchema,
  ContextManifestSchema,
  canonicalAgentIdField,
} from "@rah-os/protocol";
import { readAgentMemoryWorkspaceFile } from "./agent-memory-materialization.ts";
import { agentMemoryWorkspacePath } from "./agent-memory-workspace.ts";

/** Combine required startup reads; no memory selection, delivery ACK or new authority. */
export async function workerStartupContext(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string> {
  const context: Record<string, unknown> = {};
  for (const key of [
    "RAH_ACTIVATION_ID",
    "RAH_PARTICIPANT_ID",
    "RAH_ROOM_ID",
    "RAH_FROM_SEQ",
    "RAH_TO_SEQ",
  ])
    if (env[key] !== undefined) context[key] = env[key];
  if (env.RAH_AGENT_CONTEXT_JSON) {
    const agent = AgentRuntimeContextSchema.parse(
      canonicalAgentIdField(JSON.parse(env.RAH_AGENT_CONTEXT_JSON)),
    );
    context.agent = {
      participantId: agent.participantId,
      handle: agent.handle,
      revision: agent.agentDefinitionRevision.agentDefinitionRevisionId,
    };
  }
  if (env.RAH_CONTEXT_MANIFEST_JSON)
    // Validate the frozen manifest; technical provenance stays in the host,
    // not repeated in model conversation history. Scope above remains explicit.
    ContextManifestSchema.parse(JSON.parse(env.RAH_CONTEXT_MANIFEST_JSON));
  if (env.RAH_AGENT_APP_INBOX_JSON)
    context.appInbox = JSON.parse(env.RAH_AGENT_APP_INBOX_JSON);

  const index = await readMemoryIndexAgainstSystemSnapshot(env);
  // S6 batch B: an S6 session (a Role instance) has no per-instance memory
  // directory; its memory is the channel memory.
  if (index === undefined)
    return `## Current Activation context\n${JSON.stringify(context)}\n\nChannel memory: the index is at the end of your standing prompt; later changes arrive in wakes; \`memory list\` shows the current index.\n\n## Canonical Room delivery\n`;
  if (index.matchesSystem)
    return `## Current Activation context\n${JSON.stringify(context)}\n\nThe complete original MEMORY.md is supplied in the current system prompt; the current file still matches that launch snapshot. Read that data completely.\n\n## Canonical Room delivery\n`;
  return `## Current Activation context\n${JSON.stringify(context)}\n\n## Complete original MEMORY.md\n${index.content}\n\n## Canonical Room delivery\n`;
}

/**
 * The startup memory fallback, shared by `message-check --startup` and the
 * S1-d bodied wake: always read and validate the full current index, and
 * compare it with RAH_AGENT_MEMORY_SYSTEM_SHA256 — the native session's FIRST
 * system snapshot on resume (`ProviderSystemMemory`), never the current file's
 * own digest. Only an exact match lets the caller omit the index. This is a
 * transport optimization, not a model-read, delivery or Task receipt.
 * Undefined when the launch has no memory workspace.
 */
export async function readMemoryIndexAgainstSystemSnapshot(
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ content: string; matchesSystem: boolean } | undefined> {
  const directory = env.RAH_AGENT_MEMORY_DIR;
  if (directory === undefined) return undefined;
  const participantId = env.RAH_PARTICIPANT_ID;
  if (
    !participantId ||
    agentMemoryWorkspacePath(dirname(directory), participantId) !== directory ||
    env.RAH_AGENT_MEMORY_INDEX !== join(directory, "MEMORY.md")
  )
    throw new Error("Startup memory path does not match the Agent owner");
  const read = await readAgentMemoryWorkspaceFile({
    rootDirectory: dirname(directory),
    ownerParticipantId: participantId,
    relativePath: "MEMORY.md",
  });
  return {
    content: read.content,
    matchesSystem:
      env.RAH_AGENT_MEMORY_SYSTEM_SHA256 ===
      createHash("sha256").update(read.content).digest("hex"),
  };
}
