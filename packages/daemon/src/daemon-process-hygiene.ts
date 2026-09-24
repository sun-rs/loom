import {
  createSystemProcessTable,
  LeftoverProcessSweeper,
  RuntimeProcessHygiene,
} from "@rah-os/agent-host";

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
