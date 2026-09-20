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
  if (env.RAH_AGENT_CONTEXT_JSON)
    context.agent = AgentRuntimeContextSchema.parse(
      canonicalAgentIdField(JSON.parse(env.RAH_AGENT_CONTEXT_JSON)),
    );
  if (env.RAH_CONTEXT_MANIFEST_JSON)
    context.manifest = ContextManifestSchema.parse(
      JSON.parse(env.RAH_CONTEXT_MANIFEST_JSON),
    );
  if (env.RAH_AGENT_APP_INBOX_JSON)
    context.appInbox = JSON.parse(env.RAH_AGENT_APP_INBOX_JSON);

  let memory =
    "Memory path unavailable; read the original index when configured.";
  const directory = env.RAH_AGENT_MEMORY_DIR;
  if (directory !== undefined) {
    const participantId = env.RAH_PARTICIPANT_ID;
    if (
      !participantId ||
      agentMemoryWorkspacePath(dirname(directory), participantId) !==
        directory ||
      env.RAH_AGENT_MEMORY_INDEX !== join(directory, "MEMORY.md")
    )
      throw new Error("Startup memory path does not match the Agent owner");
    const read = await readAgentMemoryWorkspaceFile({
      rootDirectory: dirname(directory),
      ownerParticipantId: participantId,
      relativePath: "MEMORY.md",
    });
    memory = read.content;
  }
  return `## Current Activation context\n${JSON.stringify(context)}\n\n## Complete original MEMORY.md\n${memory}\n\n## Canonical Room delivery\n`;
}
