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

export type PreparedChannelPrimaryDirectory = Readonly<{
  primaryDirectory: string;
  rollback(): void;
}>;
/**
 * `additionalDirectories` are the Channel's Human-attached directories: the
 * Host records their identities in this same preparation (review 2026-09-26
 * minor fix), so a directory replaced before the first binding is refused.
 */
export type ChannelPrimaryDirectoryPreparer = (
  roomId: string,
  additionalDirectories: readonly string[],
) => PreparedChannelPrimaryDirectory;

export type RoomKernelOptions = {
  /**
   * Owner 2026-09-26: the Host-side check of Human-attached Channel
   * directories (exists, is a directory, canonical, outside Loom data). It
   * throws with a reason; without it attached directories are refused.
   */
  channelAttachedDirectoryValidator?: (paths: readonly string[]) => void;
  /**
   * Owner 2026-09-26 (P2-2 option A): the Host creates a new Channel's
   * primary directory during Channel creation (Kernel never touches the
   * filesystem). Called inside the creation transaction once every Kernel
   * check has passed; a throw fails the creation with no Channel row. The
   * returned absolute path is recorded and never re-derived. If the Kernel
   * transaction then fails, `rollback` is called to remove the directory.
   */
  channelPrimaryDirectoryPreparer?: ChannelPrimaryDirectoryPreparer;
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
  /**
   * Contract §2: whether a legacy persona Agent (an Agent definition that is
   * not a Role instance) still gets Inbox items and Activations. The product
   * composition (`DaemonApplication`) passes `false`; the Kernel default keeps
   * the unit tests that still use persona definitions as generic Agent
   * fixtures (retiring: remove once they move to Role instances).
   */
  scheduleLegacyPersonas?: boolean;
};
