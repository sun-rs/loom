/**
 * evo §57: which runtimes carry the Loom Worker tool facade, and what the
 * model sees them as. Dependency-free on purpose: the standing protocol, the
 * wake renderer, the daemon's prompt lease and the Worker CLI's help card all
 * read this one decision.
 *
 * The daemon's standing-prompt lease is the single place that decides a
 * launch uses the tools (`workerToolModeForRuntime`); it sets
 * `RAH_WORKER_TOOLS` in that launch's lease environment. Everything
 * downstream follows the lease, never a guess: the driver injects the MCP
 * entry only when the lease says so (and fails the launch when it cannot),
 * the Host renders the tool `Reply:` line only for such a launch, and the
 * Worker CLI running under that Provider renders the matching help card.
 *
 * This batch wires OpenCode only (owner decision 2026-09-27); Claude, Codex
 * and Kimi keep the CLI form byte for byte.
 */
export const RAH_WORKER_TOOLS_ENV = "RAH_WORKER_TOOLS";

/**
 * Daemon-side experiment switch (the paid A/B `cli-post` arm): `off` keeps
 * OpenCode on the CLI reply path. Read from the daemon's own environment;
 * the `RAH_` namespace never reaches a Provider child by inheritance.
 */
export const RAH_OPENCODE_WORKER_TOOLS_ENV = "RAH_OPENCODE_WORKER_TOOLS";

export type WorkerToolMode = "opencode";

export type WorkerToolNames = Readonly<{ post: string; check: string }>;

/**
 * OpenCode 1.18.32 names an MCP tool `<server>_<tool>` (review 2026-09-27:
 * `loom_message_post` observed on a fake model API).
 */
const TOOL_NAMES: Readonly<Record<WorkerToolMode, WorkerToolNames>> = {
  opencode: Object.freeze({
    post: "loom_message_post",
    check: "loom_message_check",
  }),
};

export function workerToolNames(
  mode: string | undefined,
): WorkerToolNames | undefined {
  return mode !== undefined && Object.hasOwn(TOOL_NAMES, mode)
    ? TOOL_NAMES[mode as WorkerToolMode]
    : undefined;
}

export function workerToolModeForRuntime(
  runtimeId: string,
  daemonEnv: Readonly<Record<string, string | undefined>>,
): WorkerToolMode | undefined {
  if (runtimeId !== "opencode") return undefined;
  return daemonEnv[RAH_OPENCODE_WORKER_TOOLS_ENV] === "off"
    ? undefined
    : "opencode";
}
