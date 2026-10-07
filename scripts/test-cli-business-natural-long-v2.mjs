// New observation identity; prior strict and natural-v1 samples remain unchanged.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { naturalBusinessLongInvocation } from "./test-cli-business-natural-long.mjs";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { validateNaturalBusinessObservationRoundV2 } from "./cli-efficiency/business-observation-validation.mjs";
function invocation(args) {
  const { mode, profile } = naturalBusinessLongInvocation(args),
    id = "business-observation-natural-long/v2";
  return {
    mode,
    profile: {
      ...profile,
      completionPolicy: "canonical-and-ack/v2",
      nativePromptTransports: { opencode: "stdin" },
      order: [...profile.order].reverse(),
      experimentVersion: id,
      sampleId: `${id}/pair-${profile.validationPolicy.study.pairIndex}`,
      validationPolicy: {
        ...profile.validationPolicy,
        id: "canonical-natural-business-observation/v2",
        study: { ...profile.validationPolicy.study, id },
        execution:
          "unique explicit canonical Room delivery, successful publishing Run identified by canonical Activation and exact native tool receipt provenance when multiple attempts occur, real consumer ACK; retain every attempt and unknown effects stop",
      },
      validateRound: validateNaturalBusinessObservationRoundV2,
    },
  };
}
export function naturalBusinessLongV2Plan(args, version, environment = {}) {
  const { mode, profile } = invocation(args);
  return multiPlan([mode], version, profile, environment);
}
export function runNaturalBusinessLongV2(args) {
  const { mode, profile } = invocation(args);
  return runMultiChannel([mode], profile);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runNaturalBusinessLongV2(process.argv.slice(2));
