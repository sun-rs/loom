import type { RuntimeCertification } from "@rah-os/protocol";

export type PlacementCapacityPolicy = {
  defaultMaxConcurrent?: number;
  hostLimits?: ReadonlyArray<{
    hostId: string;
    maxConcurrent: number;
  }>;
  poolLimits?: ReadonlyArray<{
    capacityPoolId: string;
    maxConcurrent: number;
  }>;
  runtimeProfileLimits?: ReadonlyArray<{
    hostId: string;
    maxConcurrent: number;
    runtimeProfileId: string;
  }>;
};

/**
 * Whether several Runs may hold the same `in_place` workspace mount at once.
 *
 * `"shared"` (the default) matches upstream Raft, which has no workspace lock
 * at all: every Agent in a Room can answer one Human message concurrently.
 * `"exclusive"` restores the original one-writer-per-mount rule, serializing
 * every Agent that shares a mount — revertible without a code change.
 */
export type InPlaceWorkspaceSharing = "exclusive" | "shared";

export type RoomKernelOptions = {
  createId?: (prefix: string) => string;
  databasePath: string;
  inPlaceWorkspaceSharing?: InPlaceWorkspaceSharing;
  now?: () => Date;
  placementCapacityPolicy?: PlacementCapacityPolicy;
  reminderDefaultTimezone?: string;
  reminderFireDeliveryHook?: (input: {
    occurrenceId: string;
    reminderId: string;
    reminderVersion: number;
  }) => void;
  runtimeCertifications?: RuntimeCertification[];
  runtimeOfferClockSkewMs?: number;
  runtimeOfferMaxTtlMs?: number;
};
