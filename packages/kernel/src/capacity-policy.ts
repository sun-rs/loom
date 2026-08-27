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
