// Independent default Worker MCP measurement profile; no paid authorization implied.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { longHash } from "./cli-efficiency/long-session-support.mjs";
import {
  inlineWorkload,
  inlineExpected,
} from "./cli-efficiency/multi-channel-inline-workload.mjs";
import { validateMcpObservationRound } from "./cli-efficiency/multi-channel-mcp-observation.mjs";
import { summarizeMcpObservation } from "./cli-efficiency/multi-channel-mcp-observation.mjs";

const profile = {
  productArm: "worker-mcp",
  workload: inlineWorkload,
  experimentVersion: "multi-channel-mcp-observation/v1",
  sampleId: "multi-channel-mcp-observation/v1",
  roundsPerParticipant: 12,
  limits: { perArmInput: 3600000, perArmMs: 2400000, maxProductRuns: 36 },
  validationPolicy: {
    id: "exact-answer-inline-once-recovered-target/v1",
    readProofPolicy: "inline-input/v1",
    replyProof: "observed-mcp-final-reply",
    reportedGenerations:
      "retain actual positive counts; judge contract without discarding follow-up cost",
    materialDelivery:
      "evidence supplied once in first Human message; later turns use session history",
    expectedSha256: longHash(JSON.stringify(inlineExpected)),
    repeatPolicy:
      "one authorized pair; no automatic reruns; no stability claim",
    failure:
      "continue registered non-writing target rejection only after unique correct final delivery; retain all costs; otherwise stop",
    toolEvidence:
      "native zero tools; product registered target rejections then one actual MCP final reply; correlated receipts and durable marker; no other tools",
  },
  expectedFor: (round) =>
    inlineExpected[Math.floor((round.round - 1) / 3)]?.answer,
  validateRound: validateMcpObservationRound,
  summarize: summarizeMcpObservation,
};
export const multiMcpObservationPlan = (args, version) =>
  multiPlan(args, version, profile);
export const runMultiChannelMcpObservation = (args) =>
  runMultiChannel(args, profile);
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMultiChannelMcpObservation(process.argv.slice(2));
