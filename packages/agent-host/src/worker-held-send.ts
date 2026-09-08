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

/** Raft's `THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED` output, ported with RAH
 * command names: the send was refused, the composition is saved as this
 * target's draft, and exactly two paths resolve it. */
export function workerTargetConfirmationGuidance(
  result: unknown,
): string | undefined {
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
  const parent = shellQuote(value.parentTarget),
    thread = shellQuote(value.threadTarget);
  return `THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED: message was NOT sent; no target delivery occurred.
Possible thread target mismatch: your latest read context under ${parent} is ${thread}, but this send targets ${parent} top-level.
This guard is intentionally narrow: moving a thread conclusion to the parent channel can be correct, but it is uncommon enough to confirm once.

If this reply belongs in the thread, send the message to the thread target instead:
  rah worker message-post --target ${thread} <<'${MESSAGE_HEREDOC_DELIMITER}'
  message body
  ${MESSAGE_HEREDOC_DELIMITER}

If the top-level channel message is intentional, send the saved draft unchanged:
  rah worker message-post --send-draft --target ${parent}

No message was sent. Send to ${thread} if this belongs in the thread, or confirm the saved top-level draft with \`rah worker message-post --send-draft --target ${parent}\`.
`;
}

export function workerHeldSendGuidance(result: unknown): string | undefined {
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
        } omitted from this notice and no longer block this action; use rah worker message-read explicitly if you need earlier context.`
      : "";
  const continueAnyway =
    value.continueAnywaySuggested === true
      ? `If repeated updates keep blocking the same draft and this is still the right reply, you may use:
  rah worker message-post --send-draft --anyway --target ${target}
`
      : "";
  return `SEND_HELD_AS_DRAFT: message was NOT sent; no target delivery occurred.
Freshness hold: showing latest ${String(shownMessageCount)} of ${String(
    newMessageCount,
  )} newer message${newMessageCount === 1 ? "" : "s"}.${omittedNote}
Your message has been saved as a draft. Review the bounded context shown here, then choose one path.
${renderNewerMessages(value)}
To update the draft, send revised content normally:
  rah worker message-post --target ${target} <<'${MESSAGE_HEREDOC_DELIMITER}'
  revised message
  ${MESSAGE_HEREDOC_DELIMITER}
To send the current draft unchanged:
  rah worker message-post --send-draft --target ${target}
You can also choose not to send anything.
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
  const messageId = messageIdentifier(result);
  const sentStatusLine =
    target === undefined ? "Message sent." : `Message sent to ${target}.`;
  if (messageId === undefined) return `${sentStatusLine}\n`;
  const shortId = messageId.slice(0, 8);
  const replyHint =
    target === undefined
      ? ""
      : ` (to reply in this message's thread, use target "${
          target.includes(":") ? target : `${target}:${shortId}`
        }")`;
  return `${sentStatusLine} Message ID: ${messageId}${replyHint}\n`;
}

/**
 * Raft's `renderError` text mode, narrowed to the two typed send refusals: a
 * short `Error:`/`Code:` summary on stderr while the body that teaches recovery
 * goes to stdout.
 */
export function workerSendErrorSummary(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("state" in result))
    return undefined;
  if (result.state === "held")
    return "Error: Message held as draft; no target delivery occurred.\nCode: SEND_HELD_AS_DRAFT\n";
  if (result.state === "target_confirmation_required")
    return "Error: message was NOT sent; no target delivery occurred.\nCode: THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED\n";
  return undefined;
}
