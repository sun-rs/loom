import {
  deliveryInstructions,
  type PromptDeliveryMode,
} from "./standing-prompt-delivery.ts";
import { createHash } from "node:crypto";

import {
  authoritySection,
  buildAgentMemoryInstructions,
  CHANNEL_MEMORY_POINTER,
  communicationStyleSection,
  credentialHygieneSection,
  formattingSection,
  remindersSection,
  startupRulesSection,
  workerCliSection,
  type WorkerToolNames,
} from "@rah-os/agent-host";

export const STANDING_PROMPT_COMPILER_VERSION = 1;

export type StandingPromptAgentLayer = {
  displayName?: string;
  handle?: string;
  participantId?: string;
  role: string;
  description?: string;
  instructions?: string;
};

export type StandingPromptRuntimeContext = {
  deliveryMode?: PromptDeliveryMode;
  hostId?: string;
  machineHostname?: string;
  machineOs?: string;
  daemonVersion?: string;
  workspacePath?: string;
  /**
   * Owner 2026-09-26: the channel's attached directories, only for a CLI
   * without a native mechanism (OpenCode); others learn them natively.
   */
  attachedDirectories?: readonly string[];
  roomId?: string;
  workspaceMode?: string;
  toolAccessMode?: string;
};

export type StandingPromptInput = {
  agent?: StandingPromptAgentLayer;
  runtimeContext?: StandingPromptRuntimeContext;
  /**
   * S6 batch B: a Role instance session. Its memory is the channel memory:
   * one pointer line replaces the legacy MEMORY.md prose and the rendered
   * index is the last layer. The index text stays out of the continuity
   * digest (an edit to memory never keys a different session).
   */
  channelMemory?: { section: string };
  /**
   * evo §57: the launch carries the Loom Worker tools under these names, so
   * posting and checking are stated as tool calls (part of the digest).
   */
  workerTools?: WorkerToolNames;
};

export type CompiledStandingPrompt = {
  prompt: string;
  deterministicDigest: string;
  compilerVersion: number;
};

export type StandingPromptLayer = { id: string; text: string };

const LEGACY_IDENTITY_SENTENCE =
  "You are a RAH OS Room worker launched for one durable Activation.";

function identityLayer(
  agent: StandingPromptAgentLayer | undefined,
  channelMemory: boolean,
): string {
  if (!agent) {
    return LEGACY_IDENTITY_SENTENCE;
  }
  const name = agent.displayName ?? agent.handle ?? agent.participantId ?? "";
  const ids: string[] = [];
  if (agent.handle) ids.push(`handle is \`@${agent.handle}\``);
  if (agent.participantId)
    ids.push(`participant id is \`${agent.participantId}\``);
  const idLine = ids.length > 0 ? ` Your ${ids.join(" and your ")}.` : "";
  return `You are "${name}", an Agent in RAH OS — a Room-first workplace where one Human and several Agents collaborate through canonical Room messages and Tasks.${idLine} ${channelMemory ? "Your Workspace and your channel's memory persist across Activations." : "Your Workspace and MEMORY.md persist across Activations."}`;
}

function runtimeContextLayer(
  context: StandingPromptRuntimeContext | undefined,
): string | undefined {
  if (!context) {
    return undefined;
  }
  const lines: string[] = [];
  if (context.hostId) lines.push(`- Host: ${context.hostId}`);
  if (context.machineHostname)
    lines.push(`- Hostname: ${context.machineHostname}`);
  if (context.machineOs) lines.push(`- OS: ${context.machineOs}`);
  if (context.daemonVersion) lines.push(`- Daemon: v${context.daemonVersion}`);
  if (context.workspacePath)
    lines.push(`- Workspace: ${context.workspacePath}`);
  for (const directory of context.attachedDirectories ?? [])
    lines.push(`- Attached directory: ${directory}`);
  if (context.roomId) lines.push(`- Room: ${context.roomId}`);
  if (context.workspaceMode)
    lines.push(`- Workspace mode: ${context.workspaceMode}`);
  if (context.toolAccessMode)
    lines.push(`- Tool access: ${context.toolAccessMode}`);
  if (lines.length === 0) {
    return undefined;
  }
  return `## Current Runtime Context

This is authoritative context injected by RAH OS. Do not infer Computer identity from hostname or cwd when this section is present.

${lines.join("\n")}`;
}

/**
 * P2-3: the protocol sections (precedence, Worker CLI and Tasks, credential
 * handling, reminders, communication style, formatting, startup rules) live
 * in `@rah-os/agent-host` `standing-protocol.ts`, moved there verbatim, so the
 * prompt, `STANDING_PROTOCOL_VERSION` and `worker help protocol` render one
 * source. This compiler still composes them in the same order.
 */
function platformLayer(
  agent: StandingPromptAgentLayer | undefined,
  channelMemory: boolean,
  tools: WorkerToolNames | undefined,
): string {
  if (agent && channelMemory)
    return `If the wake lacks your messages, run \`"$RAH_WORKER_CLI" worker message-check --startup\` (identity, scope, messages; validates RAH_AGENT_CONTEXT_JSON and RAH_CONTEXT_MANIFEST_JSON). Your role is stated in this prompt; do not duplicate it.
${CHANNEL_MEMORY_POINTER}

${workerCliSection(tools)}`;
  const bootstrap = agent
    ? 'If the wake lacks your messages, run `"$RAH_WORKER_CLI" worker message-check --startup` (identity, scope, memory index, messages; validates RAH_AGENT_CONTEXT_JSON and RAH_CONTEXT_MANIFEST_JSON). Your role is stated in this prompt; do not duplicate it.'
    : "First parse process.env.RAH_AGENT_CONTEXT_JSON and process.env.RAH_CONTEXT_MANIFEST_JSON. The first contains the frozen AgentDefinition role and instructions; the second is the Kernel-owned audit record of the exact Room range, instruction/skill/memory content references, RuntimeProfile and Workspace revision selected for this RunAttempt. Follow those instructions unless they conflict with the canonical Worker protocol or system safety. Do not substitute mutable latest files for the manifest references.";
  return `${bootstrap}
${buildAgentMemoryInstructions()}

${workerCliSection(tools)}`;
}

function workspacePolicyLayer(
  context: StandingPromptRuntimeContext | undefined,
): string | undefined {
  const lines: string[] = [];
  if (context?.workspaceMode) {
    lines.push(
      `Workspace mode: ${context.workspaceMode} (recorded by RAH OS for this Activation).`,
    );
  }
  if (context?.toolAccessMode) {
    lines.push(
      `Tool access: ${context.toolAccessMode} (recorded by RAH OS for this Activation).`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function initialRoleLayer(
  agent: StandingPromptAgentLayer | undefined,
): string | undefined {
  if (!agent) {
    return undefined;
  }
  const blocks: string[] = [`## Initial role`, agent.role];
  if (agent.description) {
    blocks.push(agent.description);
  }
  if (agent.instructions) {
    blocks.push(`### Instructions`, agent.instructions);
  }
  blocks.push("This may evolve.");
  return blocks.join("\n\n");
}

/** The launch delivery-mode section, then the constant per-turn rules. */
function startupLayer(
  mode?: PromptDeliveryMode,
  tools?: WorkerToolNames,
): string {
  return `${deliveryInstructions(mode)}

${startupRulesSection(tools)}`;
}

export function standingPromptLayers(
  input?: StandingPromptInput,
): readonly StandingPromptLayer[] {
  const agent = input?.agent;
  const channelMemory = input?.channelMemory !== undefined;
  const candidates: readonly (StandingPromptLayer | undefined)[] = [
    { id: "identity", text: identityLayer(agent, channelMemory) },
    runtimeContextLayer(input?.runtimeContext) === undefined
      ? undefined
      : {
          id: "runtime-context",
          text: runtimeContextLayer(input?.runtimeContext)!,
        },
    { id: "authority", text: authoritySection() },
    {
      id: "platform",
      text: platformLayer(agent, channelMemory, input?.workerTools),
    },
    { id: "credential-hygiene", text: credentialHygieneSection() },
    { id: "reminders", text: remindersSection() },
    { id: "communication-style", text: communicationStyleSection() },
    { id: "formatting", text: formattingSection() },
    workspacePolicyLayer(input?.runtimeContext) === undefined
      ? undefined
      : {
          id: "workspace-policy",
          text: workspacePolicyLayer(input?.runtimeContext)!,
        },
    initialRoleLayer(agent) === undefined
      ? undefined
      : { id: "initial-role", text: initialRoleLayer(agent)! },
    {
      id: "startup",
      text: startupLayer(
        input?.runtimeContext?.deliveryMode,
        input?.workerTools,
      ),
    },
    input?.channelMemory === undefined
      ? undefined
      : { id: "channel-memory", text: input.channelMemory.section },
  ];
  return candidates.filter(
    (layer): layer is StandingPromptLayer =>
      layer !== undefined && layer.text.trim() !== "",
  );
}

function renderLayers(input?: StandingPromptInput): string {
  return standingPromptLayers(input)
    .map((layer) => layer.text)
    .join("\n\n");
}

export function compileStandingPrompt(
  input?: StandingPromptInput,
): CompiledStandingPrompt {
  const prompt = renderLayers(input);
  // Host/Room/cwd are runtime context; delivery instructions are behavioral
  // defaults and must participate in the provider-session continuity digest.
  const deterministic = renderLayers({
    ...(input?.agent === undefined ? {} : { agent: input.agent }),
    ...(input?.channelMemory === undefined
      ? {}
      : { channelMemory: { section: "## Channel memory index" } }),
    ...(input?.workerTools === undefined
      ? {}
      : { workerTools: input.workerTools }),
    runtimeContext: {
      deliveryMode: input?.runtimeContext?.deliveryMode ?? "wait",
    },
  });
  return {
    compilerVersion: STANDING_PROMPT_COMPILER_VERSION,
    deterministicDigest: createHash("sha256")
      .update(deterministic, "utf8")
      .digest("hex"),
    prompt,
  };
}
