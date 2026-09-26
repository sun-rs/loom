export function capacityProfileResourceId(
  hostId: string,
  runtimeProfileId: string,
): string {
  return JSON.stringify([hostId, runtimeProfileId]);
}

export function assertPositiveCapacityLimit(
  value: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

export function capacityLimitMap<T extends { maxConcurrent: number }>(
  limits: ReadonlyArray<T>,
  keyOf: (limit: T) => string,
  label: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const limit of limits) {
    const key = keyOf(limit);
    if (key.trim().length === 0) {
      throw new Error(`${label} capacity limit identity must not be empty`);
    }
    assertPositiveCapacityLimit(
      limit.maxConcurrent,
      `${label} capacity limit ${key}`,
    );
    if (result.has(key)) {
      throw new Error(`duplicate ${label} capacity limit: ${key}`);
    }
    result.set(key, limit.maxConcurrent);
  }
  return result;
}

type PlacementCapacityLimitsInput = {
  defaultMaxConcurrent?: number;
  hostLimits?: ReadonlyArray<{ hostId: string; maxConcurrent: number }>;
  poolLimits?: ReadonlyArray<{ capacityPoolId: string; maxConcurrent: number }>;
  runtimeProfileLimits?: ReadonlyArray<{
    hostId: string;
    maxConcurrent: number;
    runtimeProfileId: string;
  }>;
};

/**
 * The single owner of placement capacity limits. Limits are operator settings,
 * not durable Room state: the daemon persists them and may replace the Host
 * and runtime-profile families at runtime. Each scheduling pass reads the
 * current values, so a change applies to the next placement; placements that
 * already reserve capacity are never revoked.
 */
export class PlacementCapacityLimits {
  readonly defaultMaxConcurrent: number;
  #hostLimits: Map<string, number>;
  readonly #poolLimits: Map<string, number>;
  #profileLimits: Map<string, number>;

  constructor(policy: PlacementCapacityLimitsInput) {
    this.defaultMaxConcurrent = policy.defaultMaxConcurrent ?? 1;
    assertPositiveCapacityLimit(
      this.defaultMaxConcurrent,
      "placementCapacityPolicy.defaultMaxConcurrent",
    );
    this.#hostLimits = hostLimitMap(policy.hostLimits ?? []);
    this.#poolLimits = capacityLimitMap(
      policy.poolLimits ?? [],
      ({ capacityPoolId }) => capacityPoolId,
      "capacity pool",
    );
    this.#profileLimits = profileLimitMap(policy.runtimeProfileLimits ?? []);
  }

  /** Replaces each given family wholesale; validation precedes any change. */
  update(
    policy: Pick<
      PlacementCapacityLimitsInput,
      "hostLimits" | "runtimeProfileLimits"
    >,
  ): void {
    const hostLimits =
      policy.hostLimits === undefined
        ? undefined
        : hostLimitMap(policy.hostLimits);
    const profileLimits =
      policy.runtimeProfileLimits === undefined
        ? undefined
        : profileLimitMap(policy.runtimeProfileLimits);
    if (hostLimits !== undefined) this.#hostLimits = hostLimits;
    if (profileLimits !== undefined) this.#profileLimits = profileLimits;
  }

  plannerLimits() {
    return {
      defaultMaxConcurrent: this.defaultMaxConcurrent,
      hostLimits: this.#hostLimits as ReadonlyMap<string, number>,
      poolLimits: this.#poolLimits as ReadonlyMap<string, number>,
      profileLimits: this.#profileLimits as ReadonlyMap<string, number>,
    };
  }
}

function hostLimitMap(
  limits: NonNullable<PlacementCapacityLimitsInput["hostLimits"]>,
): Map<string, number> {
  return capacityLimitMap(limits, ({ hostId }) => hostId, "Host");
}

function profileLimitMap(
  limits: NonNullable<PlacementCapacityLimitsInput["runtimeProfileLimits"]>,
): Map<string, number> {
  return capacityLimitMap(
    limits,
    ({ hostId, runtimeProfileId }) =>
      capacityProfileResourceId(hostId, runtimeProfileId),
    "runtime profile",
  );
}
