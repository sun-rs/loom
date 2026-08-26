import type { RuntimeProfileProbeObservation } from "./runtime-profile-registry.ts";

const issuedProbeObservations = new WeakSet<object>();

export function issueRuntimeProfileProbeObservation(
  observation: RuntimeProfileProbeObservation,
): RuntimeProfileProbeObservation {
  const issued = deepFreeze(structuredClone(observation));
  issuedProbeObservations.add(issued);
  return issued;
}

export function isIssuedRuntimeProfileProbeObservation(
  observation: RuntimeProfileProbeObservation,
): boolean {
  return issuedProbeObservations.has(observation);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
