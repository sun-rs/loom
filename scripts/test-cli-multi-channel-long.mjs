// Explicit long observational profile. Merely importing or planning does not
// authorize a paid run or admit an autonomous discussion phase.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { longHash } from "./cli-efficiency/long-session-support.mjs";
import {
  multiChannelLongWorkload,
  multiChannelLongExpected,
} from "./cli-efficiency/multi-channel-long-workload.mjs";
import { validateLongChannelRound } from "./cli-efficiency/multi-channel-long-validation.mjs";

import { summarizeLongChannel } from "./cli-efficiency/multi-channel-long-summary.mjs";

const profile = {
  summarize: summarizeLongChannel,
  workload: multiChannelLongWorkload,
  experimentVersion: "multi-channel-long/v1",
  sampleId: "multi-channel-long/v1",
  roundsPerParticipant: 12,
  limits: { perArmInput: 3600000, perArmMs: 2400000, maxProductRuns: 36 },
  validationPolicy: {
    id: "exact-answer-full-initial-read-no-later-tools/v1",
    expectedSha256: longHash(JSON.stringify(multiChannelLongExpected)),
    failure: "retain raw answer and costs; stop further stages and arms",
    toolEvidence:
      "fail closed on unregistered tool forms; exact cat evidence.txt initial read only",
  },
  expectedFor: (round) =>
    multiChannelLongExpected[Math.floor((round.round - 1) / 3)]?.answer,
  validateRound: validateLongChannelRound,
};

export const multiLongPlan = (args, version) =>
  multiPlan(args, version, profile);
export const runMultiChannelLong = (args) => runMultiChannel(args, profile);

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMultiChannelLong(process.argv.slice(2));
