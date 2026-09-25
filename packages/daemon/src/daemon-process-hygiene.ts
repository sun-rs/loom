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
) {
  const processHygiene = createDaemonProcessHygiene(config.processHygiene);
  const instanceRuntimePool = createDaemonInstanceRuntimePool({
    config: config.warmRuntimes,
    host,
    hygiene: processHygiene,
    kernel,
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
 * Claude stays opt-in (`enabled: true`).
 */
export function warmRuntimeAdapterKinds(
  config: DaemonConfig["warmRuntimes"],
): ReadonlySet<string> {
  const kinds = new Set<string>();
  if (config?.codex?.enabled !== false) kinds.add("codex-app-server/v1");
  if (config?.claude?.enabled === true) kinds.add("claude-stream-json/v1");
  if (config?.opencode?.enabled !== false) kinds.add("opencode-server/v1");
  return kinds;
}

/**
 * S2-a: the Host's warm instance runtimes (Codex and S2-c3 OpenCode by
 * default, S2-c1 Claude when enabled).
 */
export function createDaemonInstanceRuntimePool(input: {
  config: DaemonConfig["warmRuntimes"];
  host: AuthenticatedHostContext;
  hygiene: RuntimeProcessHygiene | undefined;
  kernel: RoomKernel;
  stateDirectory: string;
}): InstanceRuntimePool | undefined {
  const codex = input.config?.codex;
  if (warmRuntimeAdapterKinds(input.config).size === 0) return undefined;
  if (process.platform !== "darwin" && process.platform !== "linux")
    return undefined;
  const {
    codex: _codex,
    claude: _claude,
    opencode: _opencode,
    ...policy
  } = input.config ?? {};
  return new InstanceRuntimePool({
    control: createKernelAgentHostControlPort(input.kernel, input.host),
    hostGeneration: input.host.instanceId,
    ...(input.hygiene === undefined ? {} : { hygiene: input.hygiene }),
    policy: {
      ...policy,
      ...(codex?.idleTtlMs === undefined ? {} : { idleTtlMs: codex.idleTtlMs }),
    },
    stateDirectory: join(input.stateDirectory, "warm-runtimes"),
  });
}
