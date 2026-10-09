import type {
  RuntimeProfileRevision,
  RuntimeProfileProbeReport,
  RuntimeModelBinding,
} from "@rah-os/protocol";
import type { ActivationEnvelope } from "./runtime.ts";
import type { ProviderSessionKey } from "./provider-session-store.ts";

/**
 * Per-RunAttempt memory of the standing prompt digest delivered by the daemon
 * activation lease, so recorded Provider session evidence lands on the same
 * key the launch resumed from. Adapters only carry this value; the daemon
 * compiler remains the only place a standing prompt is composed or digested.
 */
export function createStandingPromptDigestLedger(): {
  digestFor(input: ActivationEnvelope): string | undefined;
  remember(input: ActivationEnvelope, digest: string | undefined): void;
} {
  const digests = new Map<string, string>();
  return {
    digestFor: (input) => digests.get(input.runAttemptId),
    remember: (input, digest) => {
      if (digest === undefined) {
        digests.delete(input.runAttemptId);
        return;
      }
      if (digests.size >= 64 && !digests.has(input.runAttemptId)) {
        const oldest = digests.keys().next();
        if (oldest.done !== true) digests.delete(oldest.value);
      }
      digests.set(input.runAttemptId, digest);
    },
  };
}

export function providerSessionKey(
  input: ActivationEnvelope,
  revision: RuntimeProfileRevision,
  provider: string,
  standingPromptDigest?: string,
): ProviderSessionKey | undefined {
  const context = input.contextManifest;
  const placement = context?.placement;
  if (context === undefined || placement === undefined) return undefined;
  if (
    context.activationId !== input.activationId ||
    context.participantId !== input.participantId ||
    context.roomId !== input.roomId ||
    context.runAttemptId !== input.runAttemptId
  ) {
    throw new Error(
      "Provider session context identity does not match activation",
    );
  }
  if (
    placement.runtimeProfileRevisionId !== revision.runtimeProfileRevisionId ||
    placement.runtimeProfileDigest !== revision.contentDigest
  ) {
    throw new Error(
      "Provider session placement does not match the configured RuntimeProfile",
    );
  }
  return {
    participantId: input.participantId,
    provider,
    runtimeProfileRevisionId: placement.runtimeProfileRevisionId,
    // Optional so a session recorded before compiled standing prompts keeps
    // its stored key. A launch that now carries a digest keys a different
    // record, so an edited role never resumes a session started without it.
    ...(standingPromptDigest === undefined ? {} : { standingPromptDigest }),
    workspaceMountRevisionId: placement.workspaceMountRevisionId,
  };
}

export function requireModelBinding(
  report: RuntimeProfileProbeReport | undefined,
  modelBindingId: string,
): RuntimeModelBinding {
  const binding =
    report?.reportVersion === 2
      ? report.modelBindings.find(
          (candidate) => candidate.modelBindingId === modelBindingId,
        )
      : undefined;
  if (binding === undefined) {
    throw new Error(
      `Runtime probe does not contain model binding ${modelBindingId}`,
    );
  }
  return binding;
}
