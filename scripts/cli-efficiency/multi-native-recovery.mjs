// Failed stages retain reported charges; recovery never makes them admissible.
import { summarizeGenerations } from "./metrics.mjs";
import { measure } from "./common.mjs";
export function recoverMultiNativeUsage({ config, round }) {
  if (round.metrics)
    return {
      usageRecoveryEvidence: {
        source: "existing-metrics-preserved",
        completeness: "incomplete",
      },
    };
  if (config.provider === "codex")
    return {
      metrics: measure(round.sessionId, round, undefined, config),
      usageRecoveryEvidence: {
        source: "codex-transcript",
        completeness: "incomplete",
      },
    };
  const e = round.nativeUsageEvidence;
  if (!e?.generations?.length) throw Error("No known native usage to recover");
  return {
    metrics: {
      ...summarizeGenerations(e.generations, { replyAt: null }),
      usageRecoveryIncomplete: true,
      ...(e.requestCoverage ? { requestCoverage: e.requestCoverage } : {}),
    },
    usageRecoveryEvidence: {
      source: "original-native-reported-generations",
      completeness: "incomplete",
      gaps: e.gaps ?? [],
      identityVerified: false,
    },
  };
}

export function recoverFailedNativeRounds(arm, config) {
  for (const round of arm.rounds)
    if (
      !round.metrics &&
      round.startedAt &&
      round.finishedAt &&
      (round.sessionId || round.nativeUsageEvidence?.generations?.length)
    ) {
      try {
        Object.assign(round, recoverMultiNativeUsage({ config, round }));
      } catch (error) {
        round.usageRecoveryError = String(error);
      }
    }
}
