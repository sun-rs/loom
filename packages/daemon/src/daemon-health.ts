export const DAEMON_BUILD_VERSION = "0.1.0";
export const DAEMON_PROTOCOL_VERSION = 1;

export type DaemonHealthSnapshot = {
  buildVersion: string;
  hostId: string;
  participantId?: string;
  participantIds: string[];
  protocolVersion: number;
  state: "failed" | "offline" | "online" | "starting";
  lastCycleAt?: string;
  lastCycleState?: "cancelled" | "completed" | "failed" | "recovered";
  lastError?: string;
  startedAt?: string;
};
