import {
  buildCompactionSafetySection,
  buildWorkspaceAndMemorySection,
} from "./raft-memory/upstream-standing-prompt.ts";

/**
 * Raft Computer 1.0.18 memory prose is vendored, not paraphrased. The only
 * replacement inside its workspace section is the opening cwd paragraph:
 * RAH executes in a project mount, so memory uses a separate Agent directory.
 * Additional bindings are limited to filesystem/transport and authority safety.
 * Memory selection and organization remain the upstream Agent's policy.
 */
export function buildAgentMemoryInstructions(): string {
  const upstream = buildWorkspaceAndMemorySection();
  const rules = upstream.slice(upstream.indexOf("### MEMORY.md"));
  return `## Workspace & Memory

RAH filesystem binding: your persistent, agent-owned memory workspace is process.env.RAH_AGENT_MEMORY_DIR; MEMORY.md is at process.env.RAH_AGENT_MEMORY_INDEX and notes/ is relative to that memory directory, not your project cwd, which is only where repository commands run. On startup and after context compression, read the complete original MEMORY.md (continue through paginated output; a fragment is not the whole index), then only the additional notes needed for this turn.

${rules}

${buildCompactionSafetySection()}

## RAH memory bindings (not upstream Raft code)

This memory persists across Rooms, RuntimeProfiles, models and provider sessions and is not shared with another Agent; the frozen AgentDefinition outranks older notes and canonical Room/Task/ACL state remains authoritative. Never copy credentials, access tokens, private keys into memory. For RAH_AGENT_MEMORY_BOOTSTRAP_JSON, RAH_AGENT_MEMORY_SOURCE_FILE and RAH_AGENT_APP_INBOX_JSON (parse it before Room work when set), see \`loom-worker help memory\`.`;
}
