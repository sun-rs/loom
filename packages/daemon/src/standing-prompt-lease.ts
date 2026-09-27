import type { PromptDeliveryMode } from "./standing-prompt-delivery.ts";
import { hostname } from "node:os";

import type { InstanceMemoryIndex } from "@rah-os/protocol";
import {
  RAH_MEMORY_INDEX_SEQ_ENV,
  RAH_WORKER_TOOLS_ENV,
  renderChannelMemoryIndex,
  standingProtocolVersion,
  workerToolNames,
  type ActivationEnvelope,
  type ActivationEnvironmentLease,
  type WorkerToolMode,
} from "@rah-os/agent-host";

import {
  STANDING_PROMPT_COMPILER_VERSION,
  compileStandingPrompt,
} from "./standing-prompt-compiler.ts";

/**
 * Reported inside the compiled standing prompt's runtime context so an Agent
 * can name the daemon that launched it. Kept as a literal because the daemon
 * is also shipped as a single executable without its package manifest.
 */
export const DAEMON_VERSION = "0.1.0";

export type StandingPromptLeaseOptions = {
  attachedDirectories?: readonly string[];
  /**
   * S6 batch B: a Role instance's channel memory index (read by the Host
   * under its credential). `carryIndexSeq`: this launch's prompt is what the
   * session will hold (a new session, or a runtime rebuilding its system
   * layer from the launch prompt), so its seq bounds the wake delta.
   */
  channelMemory?: {
    index: InstanceMemoryIndex | undefined;
    carryIndexSeq: boolean;
  };
  deliveryMode?: PromptDeliveryMode;
  previousDeliveryMode?: PromptDeliveryMode;
  daemonVersion?: string;
  machineHostname?: string;
  machineOs?: string;
  toolAccessMode?: string;
  workspaceMode?: string;
  workspacePath?: string;
  /**
   * evo §57: this launch carries the Loom Worker tool facade. The lease is
   * the single decision: the prompt states the tools, the protocol version
   * is the tool variant's, and `RAH_WORKER_TOOLS` tells the driver to inject
   * the MCP entry (failing the launch when it cannot) and the Host to render
   * the tool `Reply:` line.
   */
  workerTools?: WorkerToolMode;
};

/**
 * The daemon is the only place a standing prompt is composed. It is delivered
 * per RunAttempt through the activation environment lease, whose `args` are
 * appended after the RuntimeProfile fixed args, so the last-wins `--prompt`
 * flag of every canonical CLI driver observes exactly this text. No adapter or
 * driver may assemble prompt text of its own.
 */
export function standingPromptLease(
  scope: ActivationEnvelope,
  options: StandingPromptLeaseOptions = {},
): ActivationEnvironmentLease | undefined {
  const agent = scope.agent;
  if (agent === undefined) {
    return undefined;
  }
  const revision = agent.agentDefinitionRevision;
  const memory = options.channelMemory;
  const memorySection =
    memory === undefined
      ? undefined
      : memory.index === undefined
        ? "## Channel memory index\nNot available at launch: use `memory list`."
        : renderChannelMemoryIndex(memory.index);
  const tools = workerToolNames(options.workerTools);
  const compilerInput = {
    ...(tools === undefined ? {} : { workerTools: tools }),
    ...(memorySection === undefined
      ? {}
      : { channelMemory: { section: memorySection } }),
    agent: {
      ...(revision.description === undefined
        ? {}
        : { description: revision.description }),
      ...(revision.displayName === undefined
        ? {}
        : { displayName: revision.displayName }),
      ...(agent.handle === undefined ? {} : { handle: agent.handle }),
      ...(revision.instructions === undefined
        ? {}
        : { instructions: revision.instructions }),
      participantId: agent.participantId,
      role: revision.role,
    },
    runtimeContext: {
      deliveryMode: options.deliveryMode ?? "wait",
      daemonVersion: options.daemonVersion ?? DAEMON_VERSION,
      hostId: scope.hostId,
      machineHostname: options.machineHostname ?? hostname(),
      machineOs: options.machineOs ?? process.platform,
      roomId: scope.roomId,
      ...(options.toolAccessMode === undefined
        ? {}
        : { toolAccessMode: options.toolAccessMode }),
      ...(options.workspaceMode === undefined
        ? {}
        : { workspaceMode: options.workspaceMode }),
      ...(options.workspacePath === undefined
        ? {}
        : { workspacePath: options.workspacePath }),
      ...(options.attachedDirectories === undefined ||
      options.attachedDirectories.length === 0
        ? {}
        : { attachedDirectories: options.attachedDirectories }),
    },
  };
  const compiled = compileStandingPrompt(compilerInput);
  const compatible =
    options.previousDeliveryMode === undefined
      ? undefined
      : compileStandingPrompt({
          ...compilerInput,
          runtimeContext: {
            ...compilerInput.runtimeContext,
            deliveryMode: options.previousDeliveryMode,
          },
        }).deterministicDigest;
  return Object.freeze({
    ...(compatible === undefined
      ? {}
      : { compatibleStandingPromptDigest: compatible }),
    args: Object.freeze(["--prompt", compiled.prompt]),
    diagnostics: Object.freeze([
      `[rah-os] standing prompt compiler v${String(STANDING_PROMPT_COMPILER_VERSION)} digest ${compiled.deterministicDigest}`,
    ]),
    env: Object.freeze({
      RAH_REQUIRE_SESSION_CONTINUITY:
        agent.instanceChannelId === undefined ? "0" : "1",
      ...(options.workerTools === undefined
        ? {}
        : { [RAH_WORKER_TOOLS_ENV]: options.workerTools }),
      ...(memory?.index !== undefined && memory.carryIndexSeq
        ? { [RAH_MEMORY_INDEX_SEQ_ENV]: String(memory.index.throughSeq) }
        : {}),
    }),
    ...(memory?.index === undefined || memorySection === undefined
      ? {}
      : {
          memoryIndex: Object.freeze({
            section: memorySection,
            throughSeq: memory.index.throughSeq,
          }),
        }),
    standingPromptDigest: compiled.deterministicDigest,
    standingProtocolVersion: standingProtocolVersion(tools),
  });
}
