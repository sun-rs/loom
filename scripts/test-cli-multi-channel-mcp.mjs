// Independent default Worker MCP measurement profile; no paid authorization implied.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { longHash } from "./cli-efficiency/long-session-support.mjs";
import {
  inlineWorkload,
  inlineExpected,
} from "./cli-efficiency/multi-channel-inline-workload.mjs";
import { validateMcpInlineRound } from "./cli-efficiency/multi-channel-mcp-validation.mjs";
import { summarizeLongChannel } from "./cli-efficiency/multi-channel-long-summary.mjs";

const profile = {
  productArm: "worker-mcp",
  workload: inlineWorkload,
  experimentVersion: "multi-channel-mcp-inline/v1",
  sampleId: "multi-channel-mcp-inline/v1",
  roundsPerParticipant: 12,
  limits: { perArmInput: 3600000, perArmMs: 2400000, maxProductRuns: 36 },
  validationPolicy: {
    id: "exact-answer-inline-once-single-mcp-final/v1",
    readProofPolicy: "inline-input/v1",
    replyProof: "single-mcp-final-reply",
    reportedGenerations:
      "retain actual positive counts; judge contract without discarding follow-up cost",
    materialDelivery:
      "evidence supplied once in first Human message; later turns use session history",
    expectedSha256: longHash(JSON.stringify(inlineExpected)),
    failure: "retain raw answer and costs; stop further stages and arms",
    toolEvidence:
      "native zero tools; product one actual MCP final reply with correlated published receipt and durable final marker; no business tools",
  },
  expectedFor: (round) =>
    inlineExpected[Math.floor((round.round - 1) / 3)]?.answer,
  validateRound: validateMcpInlineRound,
  summarize: (arms) =>
    summarizeLongChannel(arms, {
      readProofPolicy: "inline-input/v1",
      productArm: "worker-mcp",
    }),
};
export const multiMcpPlan = (args, version) =>
  multiPlan(args, version, profile);
export const runMultiChannelMcp = (args) => runMultiChannel(args, profile);
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runMultiChannelMcp(process.argv.slice(2));
