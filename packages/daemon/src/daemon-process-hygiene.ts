import { join } from "node:path";

import {
  createKernelAgentHostControlPort,
  createSystemProcessTable,
  InstanceRuntimePool,
  LeftoverProcessSweeper,
  RuntimeProcessHygiene,
} from "@rah-os/agent-host";
import type { AuthenticatedHostContext, RoomKernel } from "@rah-os/kernel";

import type { DaemonConfig } from "./config.ts";

/**
 * S2-0: leftover-process sweeps for the local Host. On by default where the
 * process table can be enumerated (macOS, Linux); `enabled: false` opts out.
 */
export function createDaemonProcessHygiene(
  config: DaemonConfig["processHygiene"],
): RuntimeProcessHygiene | undefined {
  if (config?.enabled === false) return undefined;
  if (process.platform !== "darwin" && process.platform !== "linux")
    return undefined;
  return new RuntimeProcessHygiene({
    ...(config?.caps === undefined ? {} : { caps: config.caps }),
    ...(config?.capsByParticipant === undefined
      ? {}
      : { capsByParticipant: config.capsByParticipant }),
    sweeper: new LeftoverProcessSweeper({ table: createSystemProcessTable() }),
  });
}

/** S2-0 hygiene plus the S2-a warm runtime pool it sweeps for. */
export function createDaemonRuntimeHygiene(
  config: DaemonConfig,
  host: AuthenticatedHostContext,
  kernel: RoomKernel,
  /** The persisted Host run cap (runtime concurrency settings), if any. */
  maxBusyTurns?: number,
) {
  const processHygiene = createDaemonProcessHygiene(config.processHygiene);
  const instanceRuntimePool = createDaemonInstanceRuntimePool({
    config: config.warmRuntimes,
    host,
    hygiene: processHygiene,
    hostStartTimeoutMs: config.runtimeStartTimeoutMs,
    kernel,
    ...(maxBusyTurns === undefined ? {} : { maxBusyTurns }),
    stateDirectory: config.stateDirectory,
  });
  return {
    instanceRuntimePool,
    processHygiene,
    warmRuntimeKinds: warmRuntimeAdapterKinds(config.warmRuntimes),
  };
}

/**
 * The runtime adapter kinds whose Role instances run warm. Codex and OpenCode
 * are on by default since the eighth review (`enabled: false` opts out);
 * Claude stays opt-in: explicit warm configuration or native-final adoption.
 * An explicit cold policy takes precedence over the adoption switch.
 */
export function warmRuntimeAdapterKinds(
  config: DaemonConfig["warmRuntimes"],
): ReadonlySet<string> {
  const kinds = new Set<string>();
  if (config?.codex?.enabled !== false) kinds.add("codex-app-server/v1");
  if (
    config?.claude?.enabled === true ||
    (config?.claude?.enabled === undefined &&
      process.env.LOOM_CLAUDE_NATIVE_FINAL_TRIAL === "1")
  )
    kinds.add("claude-stream-json/v1");
  if (config?.opencode?.enabled !== false) kinds.add("opencode-server/v1");
  return kinds;
}

/**
 * S2-a: the Host's warm instance runtimes (Codex and S2-c3 OpenCode by
 * default, S2-c1 Claude when enabled). Review batch 1 #7: with every warm
 * runtime switched off the pool still exists — no adapter runs warm — so
 * live runtime rows an earlier Host left (a crash while warm was on) still
 * get its Host-start janitor, and its start fence keeps a suspect row
 * blocking the per-turn path. (Whether such rows exist cannot be read here:
 * the Host instance is not active before the host starts.)
 */
export function createDaemonInstanceRuntimePool(input: {
  config: DaemonConfig["warmRuntimes"];
  host: AuthenticatedHostContext;
  hygiene: RuntimeProcessHygiene | undefined;
  /** The Host's runtime start deadline (bounds the busy-slot wait). */
  hostStartTimeoutMs?: number;
  kernel: RoomKernel;
  /**
   * The busy-turn hard cap at construction: the persisted Host run cap. Later
   * reductions are enforced by the Kernel placement planner (see
   * `InstanceRuntimePool.setMaxBusyTurns`).
   */
  maxBusyTurns?: number;
  stateDirectory: string;
}): InstanceRuntimePool | undefined {
  const codex = input.config?.codex;
  if (process.platform !== "darwin" && process.platform !== "linux")
    return undefined;
  const {
    codex: _codex,
    claude: _claude,
    opencode: _opencode,
    stallMs: _stallMs,
    toolStallMs: _toolStallMs,
    ...policy
  } = input.config ?? {};
  return new InstanceRuntimePool({
    control: createKernelAgentHostControlPort(input.kernel, input.host),
    hostGeneration: input.host.instanceId,
    ...(input.hygiene === undefined ? {} : { hygiene: input.hygiene }),
    ...(input.hostStartTimeoutMs === undefined
      ? {}
      : { hostStartTimeoutMs: input.hostStartTimeoutMs }),
    policy: {
      ...policy,
      ...(codex?.idleTtlMs === undefined ? {} : { idleTtlMs: codex.idleTtlMs }),
      ...(input.maxBusyTurns === undefined
        ? {}
        : { maxBusyTurns: input.maxBusyTurns }),
    },
    stateDirectory: join(input.stateDirectory, "warm-runtimes"),
  });
}
