// A numbered invocation runs one authorized pair, never the whole study.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { longHash } from "./cli-efficiency/long-session-support.mjs";
import {
  inlineWorkload,
  inlineExpected,
} from "./cli-efficiency/multi-channel-inline-workload.mjs";
import { validateBusinessObservationRound } from "./cli-efficiency/business-observation-validation.mjs";
import { summarizeBusinessObservation } from "./cli-efficiency/business-observation-summary.mjs";

export function businessLongInvocation(args) {
  assert.ok(
    args.length === 2 &&
      ["--plan", "--paid"].includes(args[0]) &&
      ["--pair=1", "--pair=2", "--pair=3", "--pair=4"].includes(args[1]),
    "Requires --plan --pair=1..4 or --paid --pair=1..4 in that order",
  );
  const pairIndex = Number(args[1].slice(7));
  return {
    mode: args[0],
    profile: {
      productArm: "worker-delivery",
      answerPolicy: "business-content",
      platformMemoryPolicy: "disabled",
      order:
        pairIndex % 2
          ? ["native", "worker-delivery"]
          : ["worker-delivery", "native"],
      workload: inlineWorkload,
      experimentVersion: "business-observation-long/v1",
      sampleId: `business-observation-long/v1/pair-${pairIndex}`,
      roundsPerParticipant: 12,
      limits: { perArmInput: 1500000, perArmMs: 1200000, maxProductRuns: 72 },
      validationPolicy: {
        id: "canonical-business-observation/v1",
        study: {
          id: "business-observation-long/v1",
          pairIndex,
          plannedPairs: 4,
          pairsPerInvocation: 1,
          plannedStages: 288,
          authorization:
            "explicit authorization required for each pair; no automatic admission of remaining pairs",
          repeatPolicy:
            "no automatic repeats, replacement samples, or continuation across repaired source identities",
          plannedResourceCaps: {
            allArmsInput: 12000000,
            allArmsMs: 9600000,
            productRunAttempts: 288,
          },
          capSemantics:
            "admission bounds; retain actual in-flight overshoot and all failure costs",
        },
        quality:
          "semantic factual correctness separate from delivery; errors continue with actual history",
        execution:
          "canonical delivery and exact consumer ACK; inspect authorized tool operations; unknown effects stop",
        cost: "retain all generations, retries, failures and output; no trajectory equality",
        expectedSha256: longHash(JSON.stringify(inlineExpected)),
      },
      expectedFor: (r) => inlineExpected[Math.floor((r.round - 1) / 3)]?.answer,
      validateRound: validateBusinessObservationRound,
      summarize: (arms) =>
        summarizeBusinessObservation(arms, { roundsPerParticipant: 12 }),
    },
  };
}
export function businessLongPlan(args, version, environment = {}) {
  const { mode, profile } = businessLongInvocation(args);
  return multiPlan([mode], version, profile, environment);
}
export function runBusinessLong(args) {
  const { mode, profile } = businessLongInvocation(args);
  return runMultiChannel([mode], profile);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runBusinessLong(process.argv.slice(2));
