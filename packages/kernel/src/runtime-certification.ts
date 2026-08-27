import type { RuntimeCertification } from "@rah-os/protocol";

import { canonicalDigest } from "./canonical-digest.ts";

export function computeRuntimeCertificationDigest(
  certification: Omit<RuntimeCertification, "certificationDigest">,
): string {
  return canonicalDigest({
    domain: "rah/runtime-certification/v1",
    capabilities: [...certification.capabilities].sort(),
    certificationId: certification.certificationId,
    maximumIsolation: certification.maximumIsolation,
    protocolFamily: certification.protocolFamily,
    runtimeProfileDigest: certification.runtimeProfileDigest,
  });
}
