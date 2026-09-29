/**
 * Raft 1.0.18 `CliError` + `renderError` + `markSendFailureDraftSaved`, ported
 * structurally (`main.js@29835319`, `@29836449`, `@30168709`).
 *
 * Raft's rule for the two streams is not a formatting preference: a *rendered
 * result* goes to stdout via `writeText`/`writeJson`, and a *raised error* goes
 * to stderr via `renderError`. Every field below exists so an Agent can answer
 * "did my content survive, and may I retry?" without parsing English prose.
 *
 * The proxy diagnostic fields are deliberately absent: RAH has no daemon proxy
 * layer, so `PROXY_5XX` and its seven fields describe a component that does not
 * exist here.
 */

export type WorkerServerRejection = "not_sent" | "may_already_exist";

export type WorkerCliErrorOptions = {
  cause?: unknown;
  correlationId?: string | undefined;
  details?: unknown;
  draftSaved?: boolean | undefined;
  effect?: string | undefined;
  effectState?: unknown;
  faultDomain?: string | undefined;
  layer?: string | undefined;
  outputMode?: "json" | "text" | undefined;
  retryable?: boolean | null | undefined;
  /**
   * The server answered below 500 with its own code. `not_sent`: a definite
   * pre-commit rejection (target, validation, permission, not found).
   * `may_already_exist`: an idempotency/identity conflict, where a mutation
   * under that identity may already be committed.
   */
  serverRejection?: WorkerServerRejection | undefined;
  suggestedNextAction?: string | undefined;
};

export class WorkerCliError extends Error {
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly details: unknown;
  readonly draftSaved: boolean | undefined;
  readonly effect: string | undefined;
  readonly effectState: unknown;
  readonly faultDomain: string | undefined;
  readonly layer: string | undefined;
  readonly outputMode: "json" | "text" | undefined;
  readonly retryable: boolean | null | undefined;
  readonly serverRejection: WorkerServerRejection | undefined;
  readonly suggestedNextAction: string | undefined;

  constructor(
    code: string,
    message: string,
    options: WorkerCliErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "WorkerCliError";
    this.code = code;
    this.correlationId = options.correlationId;
    this.details = options.details;
    this.draftSaved = options.draftSaved;
    this.effect = options.effect;
    this.effectState = options.effectState;
    this.faultDomain = options.faultDomain ?? options.layer;
    this.layer = options.layer;
    this.outputMode = options.outputMode;
    this.retryable = options.retryable;
    this.serverRejection = options.serverRejection;
    this.suggestedNextAction = options.suggestedNextAction;
  }
}

/** Raft's `cliError(code, message, options)`. */
export function cliError(
  code: string,
  message: string,
  options: WorkerCliErrorOptions = {},
): WorkerCliError {
  return new WorkerCliError(code, message, options);
}

/** Raft's `toCliError`: anything unrecognised is an internal bug, not a code. */
export function toWorkerCliError(error: unknown): WorkerCliError {
  if (error instanceof WorkerCliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new WorkerCliError("INTERNAL_BUG", `Unexpected error: ${message}`, {
    cause: error,
  });
}

/**
 * Raft's `markSendFailureDraftSaved`, verbatim guidance. A send that fails
 * *after* the draft was saved leaves delivery in CANNOT_CONFIRM: reading cannot
 * settle it, and resending is a decision to accept a duplicate, never a finding
 * that the original failed. This is the single guidance that prevents an Agent
 * from turning one uncertain send into two delivered messages.
 */
export const SEND_FAILURE_DRAFT_SAVED_NEXT_ACTION =
  'Delivery state is UNKNOWN: the send failed after the draft was saved, so the message may or may not have been committed. Reading CANNOT settle this. Only an authoritative identity reconciliation can — an idempotency/request/correlation identity bound by the failed request or by a server receipt, confirmed committed by an authoritative record. This CLI does not currently expose such a lookup for message send, so the honest state is CANNOT_CONFIRM. Reading is still worth doing, but it settles nothing on its own: `"$RAH_WORKER_CLI" worker message-read --target <target>` can only show that A message matching what you looked for is present, which is not the same as YOUR send having been committed unless you identified it by an authoritative identity — and this CLI does not expose that here. Wait about 90s before looking, because delivery to readable lags; that is a hint against looking too early, not a bound on visibility and not a safety gate. Not seeing it proves nothing: absence is equally consistent with committed-but-not-yet-visible, however many times and however far apart you read, and however wide the window. Matching your own text is not identity either: a hit can be someone else quoting the same string, and a miss can be a committed message you cannot see yet. So the outcome stays unknown and not retryable. Do not resend on this evidence. You may keep waiting, or reconcile out of band. Sending the draft again is a decision by a person to accept a duplicate, not a finding that the original failed, so this guidance does not direct you to it.';

/**
 * S1-b: a Worker API response below 500 whose server code belongs to a
 * definite pre-commit family (target/not found, validation, permission, state
 * conflict) is a rejection. The Kernel refuses inside the send transaction and
 * rolls it back, so no message and no draft were committed. Unlike the
 * CANNOT_CONFIRM case, resending once the cause is corrected is the right
 * action and cannot duplicate anything.
 */
export const SEND_REJECTED_NEXT_ACTION =
  'The server rejected this send before committing it: nothing was sent and this request saved no new draft. Correct the cause named in the error (for a wrong, unavailable or ambiguous target, use the Room or thread target shown in your wake or `"$RAH_WORKER_CLI" worker message-check` output), then send again; resending after correcting it is correct and cannot duplicate this message.';

/**
 * P2-2: an idempotency/identity conflict is not a clean rejection. The request
 * itself was rolled back, but the identity it carried was already used, so the
 * original message may already be committed. A resend under a new key is how
 * one send becomes two delivered messages.
 */
export const SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION =
  'The server refused this send because its idempotency identity was already used: this request committed nothing and saved no new draft, but the original message under that identity may already be committed. Read the target (`"$RAH_WORKER_CLI" worker message-read --target <target>`) and look for it by that idempotency identity before doing anything else. Do not resend with a new key or reworded content to force it through; that is a decision to accept a duplicate, not a finding that the original failed.';

/**
 * Server codes whose meaning is fixed by the Kernel/Worker API. Anything not
 * listed keeps the conservative CANNOT_CONFIRM path.
 */
const SEND_NOT_SENT_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "forbidden",
  "unauthenticated",
  "conflict",
  "stale_context",
  "thread_context_target_mismatch",
  "reply_target_mismatch",
  "body_too_large",
  "method_not_allowed",
]);
const SEND_MAY_ALREADY_EXIST_CODES: ReadonlySet<string> = new Set([
  "idempotency_conflict",
]);

export function classifyWorkerServerRejection(
  serverCode: string,
): WorkerServerRejection | undefined {
  if (SEND_MAY_ALREADY_EXIST_CODES.has(serverCode)) return "may_already_exist";
  if (
    SEND_NOT_SENT_CODES.has(serverCode) ||
    /^(invalid|unexpected)_[a-z_]+$/u.test(serverCode)
  )
    return "not_sent";
  return undefined;
}

export function markSendFailureDraftSaved(
  error: unknown,
  draftSaved: boolean,
): WorkerCliError {
  const suggestedNextAction = draftSaved
    ? SEND_FAILURE_DRAFT_SAVED_NEXT_ACTION
    : undefined;
  if (error instanceof WorkerCliError) {
    // S1-b: a definite server rejection is not an uncertain send. Only
    // transport failures, timeouts and 5xx keep the CANNOT_CONFIRM guidance.
    if (error.serverRejection !== undefined)
      return new WorkerCliError(error.code, error.message, {
        cause: error.cause,
        correlationId: error.correlationId,
        details: error.details,
        // Either way the refused request rolled back, so it saved no draft.
        draftSaved: false,
        effect: error.serverRejection,
        effectState: error.effectState,
        faultDomain: error.faultDomain,
        layer: error.layer,
        outputMode: error.outputMode,
        retryable: false,
        serverRejection: error.serverRejection,
        suggestedNextAction:
          error.serverRejection === "may_already_exist"
            ? SEND_IDEMPOTENCY_CONFLICT_NEXT_ACTION
            : (error.suggestedNextAction ?? SEND_REJECTED_NEXT_ACTION),
      });
    // A refusal that already answered "is my content saved?" keeps its answer.
    if (error.draftSaved !== undefined) return error;
    return new WorkerCliError(error.code, error.message, {
      cause: error.cause,
      correlationId: error.correlationId,
      details: error.details,
      draftSaved,
      effect: error.effect,
      effectState: error.effectState,
      faultDomain: error.faultDomain,
      layer: error.layer,
      outputMode: error.outputMode,
      retryable: error.retryable,
      suggestedNextAction: error.suggestedNextAction ?? suggestedNextAction,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new WorkerCliError("INTERNAL_BUG", `Unexpected error: ${message}`, {
    cause: error,
    draftSaved,
    suggestedNextAction,
  });
}

/** Raft's `renderError`: every branch writes to stderr, and only to stderr. */
export function renderWorkerCliError(
  stderr: { write(value: string): unknown },
  error: WorkerCliError,
): void {
  if (error.outputMode === "json") {
    const payload: Record<string, unknown> = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        fault_domain: error.faultDomain ?? null,
        layer: error.layer ?? null,
        retryable: error.retryable ?? null,
        effect: error.effect ?? null,
        correlation_id: error.correlationId ?? null,
      },
    };
    if (error.effectState !== undefined)
      payload.effect_state = error.effectState;
    if (error.details !== undefined) payload.details = error.details;
    if (error.suggestedNextAction !== undefined) {
      (payload.error as Record<string, unknown>).next_action =
        error.suggestedNextAction;
    }
    stderr.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  stderr.write(`Error: ${error.message}\n`);
  stderr.write(`Code: ${error.code}\n`);
  if (error.faultDomain !== undefined && error.faultDomain !== error.layer)
    stderr.write(`Fault domain: ${error.faultDomain}\n`);
  if (error.layer !== undefined) stderr.write(`Layer: ${error.layer}\n`);
  if (error.retryable !== undefined)
    stderr.write(
      `Retryable: ${
        error.retryable === null ? "unknown" : error.retryable ? "yes" : "no"
      }\n`,
    );
  if (error.effect !== undefined) stderr.write(`Effect: ${error.effect}\n`);
  if (error.correlationId !== undefined)
    stderr.write(`Correlation: ${error.correlationId}\n`);
  if (error.draftSaved !== undefined)
    stderr.write(`Draft saved: ${error.draftSaved ? "yes" : "no"}\n`);
  if (error.effectState !== undefined)
    stderr.write(`Effect state: ${JSON.stringify(error.effectState)}\n`);
  if (error.suggestedNextAction !== undefined)
    stderr.write(`Next action: ${error.suggestedNextAction}\n`);
}

/**
 * Raft's `apiFailureError` (`main.js` `apiFailureError`): the server's own
 * error code IS the CLI code. Raft never re-spells it, and it never drops it —
 * a 5xx with no code falls back to `SERVER_5XX`, anything else to the calling
 * command's fallback. RAH's server emits 40 stable codes through
 * `WorkerErrorResponseSchema`, so passing them through is the whole mapping;
 * the one exception is `not_found`, whose exact Raft counterpart is spelled
 * `NOT_FOUND`, and RAH's deliberately opaque 5xx code `internal_error`, which
 * is Raft's `SERVER_5XX` by construction.
 */
const RAFT_SERVER_CODE_SPELLING: Readonly<Record<string, string>> = {
  not_found: "NOT_FOUND",
};

export function workerServerFailureError(
  value: unknown,
  status: number,
  fallbackCode: string,
  requestPath?: string,
): WorkerCliError {
  const error =
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null
      ? (value.error as Record<string, unknown>)
      : {};
  const serverCode =
    typeof error.code === "string" &&
    error.code.length > 0 &&
    error.code.length <= 200
      ? error.code
      : undefined;
  const serverMessage =
    typeof error.message === "string" && error.message.length <= 2_000
      ? error.message
      : undefined;
  // Raft reads `response.suggestedNextAction` off the failure body; RAH's
  // server may attach one under the JSON name it already uses on the wire.
  const rawNextAction = error.next_action ?? error.suggestedNextAction;
  const nextAction =
    typeof rawNextAction === "string" &&
    rawNextAction.length > 0 &&
    rawNextAction.length <= 4_000
      ? rawNextAction
      : undefined;
  // Raft SEA 1.0.18 main.js:675452-675456 labels the failed Channel action,
  // while retaining the backend message and recovery guidance.
  // Task update uses the same rule at main.js:730455-730460.
  const operationCode =
    requestPath === "/v1/worker/channels/mute"
      ? "MUTE_FAILED"
      : requestPath === "/v1/worker/channels/unmute"
        ? "UNMUTE_FAILED"
        : requestPath === "/v1/worker/tasks/update-status"
          ? "UPDATE_FAILED"
          : undefined;
  const code =
    status >= 500
      ? serverCode === undefined || serverCode === "internal_error"
        ? "SERVER_5XX"
        : serverCode
      : (operationCode ??
        (serverCode === undefined
          ? fallbackCode
          : (RAFT_SERVER_CODE_SPELLING[serverCode] ?? serverCode)));
  return new WorkerCliError(
    code,
    `Worker API HTTP ${String(status)}${
      serverMessage === undefined ? "" : `: ${serverMessage}`
    }`,
    {
      serverRejection:
        status < 500 && serverCode !== undefined
          ? classifyWorkerServerRejection(serverCode)
          : undefined,
      suggestedNextAction: nextAction,
    },
  );
}
