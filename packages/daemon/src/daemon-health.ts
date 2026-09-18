import {
  resolveDaemonBuildIdentity,
  type DaemonBuildIdentity,
} from "./build-identity.ts";

// One product identity for health, capabilities, `agent_hosts.build_version`
// and the `--version` command. The protocol version below is a separate
// contract and is not derived from the release identity.
export const DAEMON_BUILD_IDENTITY: DaemonBuildIdentity =
  resolveDaemonBuildIdentity();
export const DAEMON_BUILD_VERSION = DAEMON_BUILD_IDENTITY.version;
export const DAEMON_PROTOCOL_VERSION = 1;

/**
 * The unauthenticated workbench liveness answer. Both the loopback and the LAN
 * gateway serve exactly this object so their identity answers cannot drift.
 * It is an acceptance surface, not a credential carrier: release version,
 * commit, build id and build time only.
 */
export function workbenchHealthPayload(): {
  buildIdentity: DaemonBuildIdentity;
  service: "rah-os-local-core";
  state: "online";
} {
  return {
    buildIdentity: DAEMON_BUILD_IDENTITY,
    service: "rah-os-local-core",
    state: "online",
  };
}

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
