// Explicit observation profile; the strict final-marker gate remains unchanged.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { businessLongInvocation } from "./test-cli-business-long.mjs";
import { multiPlan, runMultiChannel } from "./test-cli-multi-channel.mjs";
import { validateNaturalBusinessObservationRound } from "./cli-efficiency/business-observation-validation.mjs";
export function naturalBusinessLongInvocation(args) {
  const { mode, profile } = businessLongInvocation(args);
  const id = "business-observation-natural-long/v1";
  return {
    mode,
    profile: {
      ...profile,
      completionPolicy: "canonical-and-ack/v1",
      experimentVersion: id,
      sampleId: `${id}/pair-${profile.validationPolicy.study.pairIndex}`,
      validationPolicy: {
        ...profile.validationPolicy,
        id: "canonical-natural-business-observation/v1",
        study: { ...profile.validationPolicy.study, id },
        execution:
          "unique explicit canonical Room delivery, successful associated Run and completed Activation, exact consumer ACK and correlated Worker receipt; final marker optional but verified when present; unknown effects stop",
      },
      validateRound: validateNaturalBusinessObservationRound,
    },
  };
}
export function naturalBusinessLongPlan(args, version, environment = {}) {
  const { mode, profile } = naturalBusinessLongInvocation(args);
  return multiPlan([mode], version, profile, environment);
}
export function runNaturalBusinessLong(args) {
  const { mode, profile } = naturalBusinessLongInvocation(args);
  return runMultiChannel([mode], profile);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await runNaturalBusinessLong(process.argv.slice(2));
