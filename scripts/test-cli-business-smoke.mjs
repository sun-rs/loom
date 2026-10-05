// One explicitly authorized smoke pair; this entry never runs a long study.
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
export const businessSmokeWorkload = {
  ...inlineWorkload,
  id: "credential-inline-business-smoke-3x2/v1",
  instructions: inlineWorkload.instructions.replaceAll("12轮", "2轮"),
  steps: inlineWorkload.steps
    .slice(0, 6)
    .map((s) => ({ ...s, body: s.body.replace("36阶段", "6阶段") })),
};
const profile = {
  productArm: "worker-delivery",
  answerPolicy: "business-content",
  order: ["worker-delivery", "native"],
  workload: businessSmokeWorkload,
  experimentVersion: "business-observation-smoke/v1",
  sampleId: "business-observation-smoke/v1",
  roundsPerParticipant: 2,
  limits: { perArmInput: 600000, perArmMs: 600000, maxProductRuns: 12 },
  validationPolicy: {
    id: "canonical-business-observation/v1",
    repeatPolicy: "one smoke pair only; no automatic repeats",
    quality:
      "semantic factual correctness separate from delivery; errors continue with actual history",
    execution:
      "canonical delivery and exact consumer ACK; inspect authorized tool operations; unknown effects stop",
    cost: "retain all generations, retries, failures and output; no trajectory equality",
    expectedSha256: longHash(JSON.stringify(inlineExpected.slice(0, 2))),
  },
  expectedFor: (r) => inlineExpected[Math.floor((r.round - 1) / 3)]?.answer,
  validateRound: validateBusinessObservationRound,
  summarize: (arms) =>
    summarizeBusinessObservation(arms, { roundsPerParticipant: 2 }),
};
export const businessSmokePlan = (args, version) =>
  multiPlan(args, version, profile);
export const runBusinessSmoke = (args) => runMultiChannel(args, profile);
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runBusinessSmoke(process.argv.slice(2));
