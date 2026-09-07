import { hostname } from "node:os";

import type {
  ActivationEnvelope,
  ActivationEnvironmentLease,
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
  daemonVersion?: string;
  machineHostname?: string;
  machineOs?: string;
  toolAccessMode?: string;
  workspaceMode?: string;
  workspacePath?: string;
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
  const compiled = compileStandingPrompt({
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
    },
  });
  return Object.freeze({
    args: Object.freeze(["--prompt", compiled.prompt]),
    diagnostics: Object.freeze([
      `[rah-os] standing prompt compiler v${String(STANDING_PROMPT_COMPILER_VERSION)} digest ${compiled.deterministicDigest}`,
    ]),
    env: Object.freeze({}),
    standingPromptDigest: compiled.deterministicDigest,
  });
}
