import {
  AgentMemoryProjectHintSchema,
  type AgentMemoryProjectHint,
  type AgentMemoryRunSource,
} from "@rah-os/protocol";

export const RAH_AGENT_MEMORY_BOOTSTRAP_JSON_ENV =
  "RAH_AGENT_MEMORY_BOOTSTRAP_JSON";
export const AGENT_MEMORY_BOOTSTRAP_MAX_BYTES = 4096;
export type AgentMemoryBootstrapMode = "raft_original" | "verbatim_inline";

/**
 * Raft baseline: read the original MEMORY.md, then only the notes needed.
 * Optional transport optimization: inline the ENTIRE original text if it fits.
 * Never parse, select, normalize, truncate, summarize or reorder Markdown.
 * This byte budget bounds the envelope, not a model's memory/context cost.
 */
export function buildAgentMemoryBootstrap(
  source: string | null,
  project?: AgentMemoryProjectHint,
  options: {
    mode?: AgentMemoryBootstrapMode;
    projectResolution?: AgentMemoryRunSource["resolution"];
  } = {},
): string {
  const hint = AgentMemoryProjectHintSchema.optional().parse(project);
  const mode = options.mode ?? "raft_original";
  const encode = (text: string, status: "read_original" | "verbatim") =>
    JSON.stringify({
      schemaVersion: 2,
      mode,
      status,
      text,
      ...(hint === undefined ? {} : { project: hint }),
      ...(options.projectResolution === undefined
        ? {}
        : { projectResolution: options.projectResolution }),
    });
  if (mode === "verbatim_inline" && source !== null) {
    const candidate = encode(source, "verbatim");
    if (
      Buffer.byteLength(candidate, "utf8") <= AGENT_MEMORY_BOOTSTRAP_MAX_BYTES
    )
      return candidate;
  }
  // Absence of inline text is a file-read instruction, never missing knowledge.
  return encode("", "read_original");
}
