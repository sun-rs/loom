import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";

export function combineActivationEnvironmentLeases(
  leases: readonly ActivationEnvironmentLease[],
  failureMessage: string,
): ActivationEnvironmentLease {
  let released = false;
  return Object.freeze({
    args: Object.freeze(leases.flatMap((lease) => lease.args ?? [])),
    diagnostics: Object.freeze(
      leases.flatMap((lease) => lease.diagnostics ?? []),
    ),
    env: Object.freeze(Object.assign({}, ...leases.map((lease) => lease.env))),
    redactions: Object.freeze(
      leases.flatMap((lease) => lease.redactions ?? []),
    ),
    release: async () => {
      if (released) return;
      released = true;
      const outcomes = await Promise.allSettled(
        [...leases].reverse().map(async (lease) => await lease.release?.()),
      );
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, failureMessage);
      }
    },
  });
}
