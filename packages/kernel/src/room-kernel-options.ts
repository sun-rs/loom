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

export type RoomKernelOptions = {
  createId?: (prefix: string) => string;
  databasePath: string;
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
