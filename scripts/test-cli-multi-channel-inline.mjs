// Explicit inline-material observational profile. Merely importing or planning does not
// authorize a paid run or admit an autonomous discussion phase.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { longHash } from "./cli-efficiency/long-session-support.mjs";
import {
  inlineWorkload,
  inlineExpected,
} from "./cli-efficiency/multi-channel-inline-workload.mjs";
import { validateInlineChannelRound } from "./cli-efficiency/multi-channel-inline-validation.mjs";

import { summarizeLongChannel } from "./cli-efficiency/multi-channel-long-summary.mjs";

const profile = {
  summarize: (arms) =>
    summarizeLongChannel(arms, { readProofPolicy: "inline-input/v1" }),
  workload: inlineWorkload,
  experimentVersion: "multi-channel-inline/v1",
  sampleId: "multi-channel-inline/v1",
  roundsPerParticipant: 12,
  limits: { perArmInput: 3600000, perArmMs: 2400000, maxProductRuns: 36 },
  validationPolicy: {
    id: "exact-answer-inline-once-no-tools/v1",
    readProofPolicy: "inline-input/v1",
    materialDelivery:
      "evidence supplied once in first Human message; later turns use session history",
    expectedSha256: longHash(JSON.stringify(inlineExpected)),
    failure: "retain raw answer and costs; stop further stages and arms",
    toolEvidence: "fail closed on any tool call; no provider file reads",
  },
  expectedFor: (round) =>
    inlineExpected[Math.floor((round.round - 1) / 3)]?.answer,
  validateRound: validateInlineChannelRound,
};

export const multiInlinePlan = (args, version) =>
  multiPlan(args, version, profile);
export const runMultiChannelInline = (args) => runMultiChannel(args, profile);

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMultiChannelInline(process.argv.slice(2));
