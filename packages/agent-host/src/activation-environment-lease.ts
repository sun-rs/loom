import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";

export function combineActivationEnvironmentLeases(
  leases: readonly ActivationEnvironmentLease[],
  failureMessage: string,
): ActivationEnvironmentLease {
  let released = false;
  const standingPromptDigests = leases.flatMap((lease) =>
    lease.standingPromptDigest === undefined
      ? []
      : [lease.standingPromptDigest],
  );
  if (new Set(standingPromptDigests).size > 1) {
    throw new Error(
      "activation environment carries conflicting standing prompt digests",
    );
  }
  const compatibleDigests = leases.flatMap((lease) => {
    if (lease.compatibleStandingPromptDigest === undefined) return [];
    if (lease.standingPromptDigest === undefined) {
      throw new Error(
        "compatible prompt digest requires its current prompt digest",
      );
    }
    return [lease.compatibleStandingPromptDigest];
  });
  if (new Set(compatibleDigests).size > 1) {
    throw new Error(
      "activation environment carries conflicting compatible prompt digests",
    );
  }
  const protocolVersions = [
    ...new Set(
      leases.flatMap((lease) =>
        lease.standingProtocolVersion === undefined
          ? []
          : [lease.standingProtocolVersion],
      ),
    ),
  ];
  if (protocolVersions.length > 1) {
    throw new Error(
      "activation environment carries conflicting standing protocol versions",
    );
  }
  const memoryIndex = leases.find(
    (lease) => lease.memoryIndex !== undefined,
  )?.memoryIndex;
  return Object.freeze({
    ...(memoryIndex === undefined ? {} : { memoryIndex }),
    ...(protocolVersions[0] === undefined
      ? {}
      : { standingProtocolVersion: protocolVersions[0] }),
    ...(compatibleDigests[0] === undefined
      ? {}
      : { compatibleStandingPromptDigest: compatibleDigests[0] }),
    ...(standingPromptDigests[0] === undefined
      ? {}
      : { standingPromptDigest: standingPromptDigests[0] }),
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
