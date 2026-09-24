import { randomInt } from "node:crypto";

import { RuntimeFailureSchema, type RuntimeFailure } from "@rah-os/protocol";

export const RUNTIME_ERROR_RETRY_BACKOFF_MAX_MS = 5 * 60_000;
export const RUNTIME_ERROR_RETRY_JITTER_RATIO = 0.1;

const AUTH_ACTION_PATTERN =
  /access token could not be refreshed|token (?:was )?(?:revoked|invalidated)|refresh token (?:was )?used|invalidated auth token|logged out|signed in elsewhere|not (?:logged|signed) in|login required|log in first|please log in|authentication (?:failed|timed out)|missing (?:api )?token|no (?:api )?token|missing credentials|credentials not found|invalid api key|api key not set/iu;
const INPUT_TOO_LARGE_PATTERN =
  /input (?:is )?too large|context (?:length|window).*(?:exceed|too large)|maximum context length|prompt is too long/iu;
const MODEL_CONFIG_PATTERN =
  /modelnotfounderror|requested entity was not found|model deprecated|model not found|model is not supported|unsupported model|\bmodel\b.*\bnot supported\b/iu;
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|capacity/iu;
const TIMEOUT_PATTERN = /timed? out|timeout/iu;
const CONNECTION_PATTERN =
  /econnreset|econnrefused|enotfound|network error|connection (?:failed|closed|reset|refused)/iu;
const STREAM_PATTERN = /provider stream|stream (?:failed|closed|error)/iu;

/**
 * A Role instance needs a Host that reports durable session binding evidence
 * to the Kernel; without it a lost binding could silently start a new session.
 * Placement on such a Host is refused (sticky: retrying cannot help).
 */
export const INSTANCE_HOST_UNSUPPORTED =
  "RAH_INSTANCE_HOST_UNSUPPORTED: this Host cannot report Role instance session binding evidence; Role instances cannot run here";

export function classifyRuntimeFailure(message: string): RuntimeFailure {
  const normalized = message.trim();
  if (normalized.length === 0) throw new Error("Runtime failure is required");
  const actionRequired = AUTH_ACTION_PATTERN.test(normalized);
  const inputTooLarge = INPUT_TOO_LARGE_PATTERN.test(normalized);
  const modelConfig = MODEL_CONFIG_PATTERN.test(normalized);
  const zeroEvidence = /codex_zero_evidence_turn_completed/iu.test(normalized);
  const continuityRequired =
    normalized.includes("RAH_SESSION_CONTINUITY_REQUIRED") ||
    normalized.includes("RAH_INSTANCE_HOST_UNSUPPORTED");
  const sticky =
    actionRequired ||
    inputTooLarge ||
    modelConfig ||
    zeroEvidence ||
    continuityRequired;
  const errorClass = actionRequired
    ? "AuthError"
    : inputTooLarge
      ? "InputTooLargeError"
      : modelConfig
        ? "ModelConfigError"
        : RATE_LIMIT_PATTERN.test(normalized)
          ? "RateLimitError"
          : /\b5\d\d\b|provider (?:server|unavailable)/iu.test(normalized)
            ? "ProviderServerError"
            : CONNECTION_PATTERN.test(normalized)
              ? "ProviderConnectionError"
              : STREAM_PATTERN.test(normalized)
                ? "ProviderStreamError"
                : TIMEOUT_PATTERN.test(normalized)
                  ? "TimeoutError"
                  : /\b404\b|not found/iu.test(normalized)
                    ? "NotFoundError"
                    : /\b4\d\d\b|provider api/iu.test(normalized)
                      ? "ProviderApiError"
                      : "RuntimeError";
  return RuntimeFailureSchema.parse({
    actionRequired,
    errorClass,
    message: normalized,
    retryDisposition: actionRequired
      ? "action_required"
      : sticky
        ? "sticky_terminal"
        : "recoverable",
    sticky,
  });
}

export function runtimeErrorRetryDelay(
  baseDelayMs: number,
  attemptCount: number,
  jitterRatio = RUNTIME_ERROR_RETRY_JITTER_RATIO,
  random = runtimeErrorJitterRandom,
): number {
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0)
    throw new Error("Runtime retry base delay must be a non-negative integer");
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1)
    throw new Error("Runtime retry attempt count must be positive");
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1)
    throw new Error("Runtime retry jitter ratio must be between 0 and 1");
  if (baseDelayMs === 0) return 0;
  const exponential = baseDelayMs * 2 ** Math.min(attemptCount - 1, 30);
  const capped = Math.min(RUNTIME_ERROR_RETRY_BACKOFF_MAX_MS, exponential);
  const sample = random();
  const boundedSample = Number.isFinite(sample)
    ? Math.max(0, Math.min(1, sample))
    : 0;
  const jitter = Math.floor(capped * jitterRatio * boundedSample);
  return Math.min(RUNTIME_ERROR_RETRY_BACKOFF_MAX_MS, capped + jitter);
}

export function runtimeErrorJitterRandom(): number {
  return randomInt(1_000_000) / 1_000_000;
}
