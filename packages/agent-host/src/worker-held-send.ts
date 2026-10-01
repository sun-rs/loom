/** Raft 1.0.18: a freshness-held send saves a draft, returns a nonzero exit,
 * and offers exactly three paths — update the draft with a normal send, send
 * the current draft unchanged, or send nothing. Ported structurally from
 * `formatFreshnessHoldOutput` + `formatHeldSendOutput`: the model supplies a
 * target and content, never a cursor, receipt, idempotency key or draft id. */

/** Raft uses an unlikely delimiter so shell snippets cannot close the heredoc. */
export const MESSAGE_HEREDOC_DELIMITER = "RAH_MESSAGE_EOF";

const MAX_RENDERED_BODY_CHARACTERS = 500;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function renderNewerMessages(value: Record<string, unknown>): string {
  const events = Array.isArray(value.newerMessages) ? value.newerMessages : [];
  const lines: string[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const row = event as Record<string, unknown>;
    const payload =
      typeof row.payload === "object" && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {};
    const body = typeof payload.body === "string" ? payload.body : "";
    const bounded =
      body.length > MAX_RENDERED_BODY_CHARACTERS
        ? `${body.slice(0, MAX_RENDERED_BODY_CHARACTERS)}…`
        : body;
    const sender = typeof row.actorId === "string" ? row.actorId : "unknown";
    const seq = typeof row.roomSeq === "number" ? String(row.roomSeq) : "?";
    lines.push(`[${seq}] ${sender}: ${bounded}`);
  }
  return lines.length === 0 ? "" : `\n${lines.join("\n")}\n`;
}

function confirmationTargets(
  result: unknown,
): { parent: string; thread: string } | undefined {
  if (
    !result ||
    typeof result !== "object" ||
    !("state" in result) ||
    result.state !== "target_confirmation_required"
  )
    return undefined;
  const value = result as Record<string, unknown>;
  if (
    typeof value.parentTarget !== "string" ||
    typeof value.threadTarget !== "string"
  )
    return undefined;
  return {
    parent: shellQuote(value.parentTarget),
    thread: shellQuote(value.threadTarget),
  };
}

/**
 * Raft's `formatThreadContextParentSendMessage` (`main.js@30167899`), ported
 * with RAH command names. Raft raises this as a `cliError`, so the body is the
 * error message and reaches the Agent on stderr — it is never a rendered
 * result, and nothing about it is written to stdout.
 */
export function workerTargetConfirmationBody(
  result: unknown,
  /** The invocation's ` --turn <handle>` (warm runtimes), else "". */
  turn = "",
): string | undefined {
  const targets = confirmationTargets(result);
  if (targets === undefined) return undefined;
  const { parent, thread } = targets;
  return [
    `Possible thread target mismatch: your latest read context under ${parent} is ${thread}, but this send targets ${parent} top-level.`,
    "This guard is intentionally narrow: moving a thread conclusion to the parent channel can be correct, but it is uncommon enough to confirm once.",
    "",
    "If this reply belongs in the thread, send the message to the thread target instead:",
    `  "$RAH_WORKER_CLI" worker message-post${turn} --progress --target ${thread} <<'${MESSAGE_HEREDOC_DELIMITER}'`,
    "  message body",
    `  ${MESSAGE_HEREDOC_DELIMITER}`,
    "",
    "If the top-level channel message is intentional, send the saved draft unchanged:",
    `  "$RAH_WORKER_CLI" worker message-post --send-draft${turn} --target ${parent}`,
  ].join("\n");
}

/** Raft's `suggestedNextAction` for the same refusal (`main.js@30174525`). */
export function workerTargetConfirmationNextAction(
  result: unknown,
  turn = "",
): string | undefined {
  const targets = confirmationTargets(result);
  if (targets === undefined) return undefined;
  return `No message was sent. Send to ${targets.thread} if this belongs in the thread, or confirm the saved top-level draft with \`"$RAH_WORKER_CLI" worker message-post --send-draft${turn} --target ${targets.parent}\`.`;
}

export function workerHeldSendGuidance(
  result: unknown,
  /** The invocation's ` --turn <handle>` (warm runtimes), else "". */
  turn = "",
): string | undefined {
  if (
    !result ||
    typeof result !== "object" ||
    !("state" in result) ||
    result.state !== "held"
  )
    return undefined;
  const value = result as Record<string, unknown>;
  if (typeof value.heldDraftId !== "string") return undefined;
  const target =
    typeof value.recoveryTarget === "string"
      ? shellQuote(value.recoveryTarget)
      : "TARGET";
  const newMessageCount =
    typeof value.newMessageCount === "number" ? value.newMessageCount : 0;
  const shownMessageCount =
    typeof value.shownMessageCount === "number"
      ? value.shownMessageCount
      : Array.isArray(value.newerMessages)
        ? value.newerMessages.length
        : 0;
  const omittedMessageCount =
    typeof value.omittedMessageCount === "number"
      ? value.omittedMessageCount
      : Math.max(0, newMessageCount - shownMessageCount);
  const omittedNote =
    omittedMessageCount > 0
      ? ` ${String(omittedMessageCount)} earlier same-target message${
          omittedMessageCount === 1 ? "" : "s"
        } omitted from this notice and no longer block this action; use "$RAH_WORKER_CLI" worker message-read explicitly if you need earlier context.`
      : "";
  const intent = value.replyIntent as
    { basedOnRoomSeq?: unknown; final?: unknown } | undefined;
  const replySuffix =
    intent && typeof intent === "object"
      ? `${typeof intent.basedOnRoomSeq === "number" && Number.isSafeInteger(intent.basedOnRoomSeq) && intent.basedOnRoomSeq >= 0 ? ` --based-on-room-seq ${String(intent.basedOnRoomSeq)}` : ""}${intent.final === true ? " --final" : " --progress"}`
      : " --progress";
  const continueAnyway =
    value.continueAnywaySuggested === true
      ? `If repeated updates keep blocking the same draft and this is still the right reply, you may use:
  "$RAH_WORKER_CLI" worker message-post --send-draft --anyway${turn} --target ${target}
`
      : "";
  return `SEND_HELD_AS_DRAFT: message was NOT sent; no target delivery occurred.
Freshness hold: showing latest ${String(shownMessageCount)} of ${String(
    newMessageCount,
  )} newer message${newMessageCount === 1 ? "" : "s"}.${omittedNote}
Your message has been saved as a draft. Saving a draft does not confirm delivery or complete this work. Review the bounded context shown here, then choose one path.
${renderNewerMessages(value)}
To update the draft, send revised content normally:
  "$RAH_WORKER_CLI" worker message-post${turn}${replySuffix} --target ${target} <<'${MESSAGE_HEREDOC_DELIMITER}'
  revised message
  ${MESSAGE_HEREDOC_DELIMITER}
If the revision is held again, review that new notice before using --send-draft.
To send the current draft unchanged:
  "$RAH_WORKER_CLI" worker message-post --send-draft${turn} --target ${target}
If no reply is needed after review, confirm delivery with:
  "$RAH_WORKER_CLI" worker message-check${turn}
A required reply must still be published; message-check does not publish the draft or complete a Task.
${continueAnyway}`;
}

/** Raft 1.0.18 `DRAFT_REPLACED_EXCERPT_LIMIT`, verbatim. */
export const DRAFT_REPLACED_EXCERPT_LIMIT = 400;

/** The body a compose discarded, as reported by the server, or nothing. */
export function workerReplacedDraftBody(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const replaced = (result as Record<string, unknown>).replacedDraft;
  if (!replaced || typeof replaced !== "object") return undefined;
  const body = (replaced as Record<string, unknown>).body;
  return typeof body === "string" && body.trim().length > 0 ? body : undefined;
}

/** Raft's `formatDraftReplacedWarning`, verbatim wording and excerpt rule. */
export function formatDraftReplacedWarning(
  target: string,
  previousContent: string,
): string {
  const trimmed = previousContent.trim();
  const excerpt =
    trimmed.length > DRAFT_REPLACED_EXCERPT_LIMIT
      ? `${trimmed.slice(0, DRAFT_REPLACED_EXCERPT_LIMIT)}… (${String(
          trimmed.length,
        )} chars total, truncated)`
      : trimmed;
  return [
    `Warning: replacing an unsent draft for ${target}.`,
    `One draft is kept per target, so the previous body is now discarded.`,
    `Discarded draft (last copy):`,
    excerpt,
  ].join("\n");
}

/**
 * RAH adaptation, not upstream. Raft writes the replacement warning only to
 * stderr. F0909G: a real Agent redirected stderr on `sync`/`acknowledge` but
 * not on its sends, so a stderr-only notice was invisible and a freshness-held
 * reply was silently discarded. One stdout line — no body, no second copy of
 * the discarded text — makes the fact reach a model that captures stdout only.
 */
export function workerReplacedDraftNotice(target: string): string {
  return `Warning: replaced an unsent draft for ${target}; see stderr for the discarded body.\n`;
}

function messageIdentifier(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const event = (result as Record<string, unknown>).event;
  if (!event || typeof event !== "object") return undefined;
  const row = event as Record<string, unknown>;
  if (typeof row.aggregateId === "string") return row.aggregateId;
  const payload =
    typeof row.payload === "object" && row.payload !== null
      ? (row.payload as Record<string, unknown>)
      : {};
  return typeof payload.messageId === "string" ? payload.messageId : undefined;
}

/**
 * Raft's success branch of `handleMessageSend`: `Message sent to <target>.
 * Message ID: <id>` plus the thread reply hint built from the first eight
 * characters of the message id. A send with no explicit target has no
 * addressable target to echo, so it reports the delivery without a hint.
 */
export function workerSendSuccessOutput(
  target: string | undefined,
  result: unknown,
): string {
  return sendReceipt(target, result, "sent");
}

/** The message id Raft echoes on a queued or sent receipt. */
export function workerSentMessageId(result: unknown): string | undefined {
  return messageIdentifier(result);
}

/**
 * Raft switches the receipt verb when a mention did not resolve:
 * `Message queued to <target>` rather than `Message sent to <target>`, so a
 * partial result is never read as a clean send.
 */
export function workerSendQueuedOutput(
  target: string | undefined,
  result: unknown,
): string {
  return sendReceipt(target, result, "queued");
}

function sendReceipt(
  target: string | undefined,
  result: unknown,
  verb: "queued" | "sent",
): string {
  const messageId = messageIdentifier(result);
  const sentStatusLine =
    target === undefined ? `Message ${verb}.` : `Message ${verb} to ${target}.`;
  if (messageId === undefined) return `${sentStatusLine}\n`;
  // A message ID is not a Thread ID; a successful post need not create a thread.
  return `${sentStatusLine} Message ID: ${messageId}\n`;
}

/** Raft's `SEND_HELD_AS_DRAFT` message and `suggestedNextAction`, verbatim. */
export const SEND_HELD_AS_DRAFT_MESSAGE =
  "Message held as draft; no target delivery occurred.";

export const SEND_HELD_AS_DRAFT_NEXT_ACTION =
  "Review the held context, then update the draft or send the current draft unchanged.";

/**
 * Raft's undelivered-mention partial result. Ported from
 * `formatPendingMentionActions(source: "send")` and the `MENTION_DELIVERY_FAILED`
 * branch of `handleMessageSend`: the queued message is a rendered result and
 * stays on stdout, the partial condition is a raised error on stderr, and the
 * status line switches from "sent" to "queued" so the two are never confused.
 */
export function workerUnresolvedMentions(result: unknown): string[] {
  if (typeof result !== "object" || result === null) return [];
  const handles = (result as Record<string, unknown>).unresolvedMentionHandles;
  if (!Array.isArray(handles)) return [];
  return handles.filter(
    (handle): handle is string => typeof handle === "string",
  );
}

/** Raft's stdout block, per token, bound to the literal `@token` as written. */
export function formatUnresolvedMentionSection(
  handles: readonly string[],
): string {
  if (handles.length === 0) return "";
  const rows = handles
    .map(
      (handle) =>
        `  @${handle} — status=not_queued reason=unknown_or_not_visible; This @mention did not notify anyone.`,
    )
    .join("\n");
  return [
    "Undelivered mentions — partial result",
    "Message effect: status=queued. Queue acceptance is the only message proof.",
    'Do not rerun `"$RAH_WORKER_CLI" worker message-post`; the message is already queued and a retry could duplicate it.',
    "Each row below is bound to the literal @token from your message.",
    "For a literal name rather than a recipient, wrap the @handle in inline or fenced code.",
    rows,
    "",
  ].join("\n");
}

/**
 * Raft's `MENTION_DELIVERY_FAILED` message. `effect: "message_queued"` and
 * `retryable: false` are the load-bearing facts: the post succeeded.
 */
export function unresolvedMentionMessage(
  messageId: string | undefined,
  count: number,
): string {
  const subject =
    messageId === undefined ? "the message" : `message ${messageId}`;
  return `Partial result for ${subject}: message status=queued; ${count} @mention${count === 1 ? "" : "s"} status=not_queued.`;
}

/**
 * Raft's `suggestedNextAction`, minus its second sentence. That sentence directs
 * the Agent to `raft mention notify <id>`, a deferred sender-side recovery
 * surface RAH does not have; no substitute is invented in its place.
 */
export const UNRESOLVED_MENTION_NEXT_ACTION =
  "The message is already queued. If an unresolved token was literal prose, wrap it in code; otherwise verify the exact handle and send only a corrected follow-up mention. Do not resend the queued message.";
