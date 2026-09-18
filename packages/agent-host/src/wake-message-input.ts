/**
 * The wake turn's text: the Activation range's actual bodies, instead of the
 * fixed literal `providerActivationInput()` returns.
 *
 * Structural port of Raft Computer 1.0.32. `RAFT_CHUNK` =
 * `slices/packages/daemon/dist/chunk-TEGPBMW7.js`, offset to `main.js` is
 * +811783.
 *
 * | RAH                        | Raft                                | Source                                  |
 * | -------------------------- | ----------------------------------- | --------------------------------------- |
 * | `formatWakeMessagesInput`  | `formatConcreteMessagesRuntimeInput` | `RAFT_CHUNK:24366-24379` (`main.js:836149`) |
 * | `formatWakeIncomingMessage`| `formatIncomingMessage`             | `RAFT_CHUNK:2763-2795`                  |
 * | `formatWakeInboxNotice`    | `formatInboxUpdateRuntimeInput`     | `RAFT_CHUNK:24381-24393` (`main.js:836164`) |
 * | `RESPONSE_TARGET_HINT`     | same                                | `RAFT_CHUNK:24350`                      |
 *
 * Addressing is rewritten for RAH (same convention as `worker-read-render.ts`):
 * `#room` for a Channel, `@handle` for a DM, `#room:threadId` for a Thread.
 * Message ids are the full canonical id — Raft's `getMessageShortId2` has no
 * RAH equivalent (`worker-read-render.ts:50-57`).
 *
 * Not ported, each with its reason: `thread_follow_reactivation` prefix (RAH
 * has no follow/unfollow re-subscription event), `third_party_event` payload
 * block, `producerFactId` lineage bracket, the `slock_cli` attachment hint
 * branch (`incomingMessageFormatOptionsForDriver`, `RAFT_CHUNK:2796-2801`,
 * switches on a chat transport RAH does not have).
 *
 * RAH additions, declared as such: non-message Room events are rendered too,
 * because the presented window covers every event type the existing
 * `message-check` page already shows (`room-sync.ts:123-127`,
 * `worker-read-render.ts:465-497`); and the notice is a bounded summary, since
 * the Kernel reports the degraded tail as a count and a range rather than a
 * list.
 */

/** `RAFT_CHUNK:24350`, verbatim. */
export const RESPONSE_TARGET_HINT =
  "Reply in the channel or create/reply in a thread as appropriate; use each message's `target` and `msg` fields to choose the exact target.";

/** `RAFT_CHUNK:24377`, verbatim. */
export const WAKE_CLOSING_LINE =
  "Respond as appropriate. Complete all your work before stopping.";

export type WakeEvent = {
  roomSeq: number;
  type: string;
  createdAt: string;
  /** Already resolved to `#room`, `@handle` or `#room:threadId`. */
  target: string;
  /** Sender handle without `@`, or the raw actor id when unresolved. */
  actor: string;
  /** Canonical message id; absent for a non-message event. */
  messageId?: string;
  senderType?: "human" | "agent" | "system" | "service";
  body?: string;
  attachments?: readonly { filename: string; sizeBytes?: number }[];
  task?: { number: number; status: string; assignee?: string };
  threadContext?: {
    parentTarget: string;
    threadTarget: string;
    parentMessage: string;
    recentMessages: readonly string[];
    historyTruncated: boolean;
  };
  /** Payload for a non-message event, rendered as one JSON line. */
  payload?: unknown;
};

export type WakeNoticeSummary = {
  count: number;
  fromSeq?: number | undefined;
  toSeq?: number | undefined;
};

/** `formatVisibleActorType`: the type rides inside the header bracket. */
function senderTypeSuffix(event: WakeEvent): string {
  return event.senderType === undefined ? "" : `<${event.senderType}>`;
}

/** `formatAttachmentSuffix2`, without the `slock_cli` hint branch. */
function attachmentSuffix(event: WakeEvent): string {
  if (event.attachments === undefined || event.attachments.length === 0)
    return "";
  const listed = event.attachments
    .map((attachment) =>
      attachment.sizeBytes === undefined
        ? attachment.filename
        : `${attachment.filename} (${attachment.sizeBytes} bytes)`,
    )
    .join(", ");
  return ` [attachments: ${listed}]`;
}

/** `RAFT_CHUNK:2787`, with RAH's assignee shape. */
function taskSuffix(event: WakeEvent): string {
  if (event.task === undefined) return "";
  const assignee =
    event.task.assignee === undefined ? "" : ` assignee=${event.task.assignee}`;
  return ` [task #${event.task.number} status=${event.task.status}${assignee}]`;
}

/** `RAFT_CHUNK:2764-2776`, `thread_join_context` prefix. */
function threadContextPrefix(event: WakeEvent): string {
  const context = event.threadContext;
  if (context === undefined) return "";
  return [
    "[RAH thread context: you were mentioned in a thread without model-visible context.]",
    `parent: ${context.parentTarget}`,
    `thread: ${context.threadTarget}`,
    `suggested next step: message-read --target "${context.threadTarget}"`,
    "",
    "Parent message:",
    context.parentMessage,
    "",
    `Recent thread context${context.historyTruncated ? " (truncated)" : ""}:`,
    context.recentMessages.length > 0
      ? context.recentMessages.join("\n")
      : "- (no earlier thread replies)",
    "",
  ].join("\n");
}

/**
 * `formatIncomingMessage` (`RAFT_CHUNK:2763-2795`) for `message.posted`. Every
 * other Room event takes the shape the Worker read renderer already uses for
 * it (`worker-read-render.ts:493-497`), so the wake text and a later
 * `message-check` describe the same fact the same way.
 */
export function formatWakeIncomingMessage(event: WakeEvent): string {
  if (event.type !== "message.posted") {
    return `seq=${event.roomSeq} time=${event.createdAt} actor=@${event.actor} type=${event.type}\n  ${JSON.stringify(event.payload ?? {})}`;
  }
  const header = `[target=${event.target} msg=${event.messageId ?? "-"} time=${event.createdAt}${senderTypeSuffix(event)}]`;
  const body = `${header} @${event.actor}: ${event.body ?? ""}${attachmentSuffix(event)}${taskSuffix(event)}`;
  const prefix = threadContextPrefix(event);
  return prefix === "" ? body : `${prefix}\n${body}`;
}

/**
 * `formatInboxUpdateRuntimeInput` (`RAFT_CHUNK:24381-24393`): content-free, and
 * it says outright that deferring the messages does not establish that there is
 * no work. RAH states a bounded range instead of Raft's per-target rows,
 * because the Kernel deliberately does not enumerate the degraded tail.
 */
export function formatWakeInboxNotice(notice: WakeNoticeSummary): string {
  if (notice.count <= 0) return "";
  const range =
    notice.fromSeq === undefined || notice.toSeq === undefined
      ? ""
      : ` in sequence range ${notice.fromSeq}-${notice.toSeq}`;
  const plural = notice.count === 1 ? "event" : "events";
  return [
    "[RAH inbox notice:",
    `${notice.count} further Room ${plural}${range} were not rendered into this turn.`,
    "]",
    "These have not been read, and they are not acknowledged by replying. Read them with `message-check` when you choose to; deferring them does not establish that there is no work.",
  ].join("\n");
}

/**
 * `formatConcreteMessagesRuntimeInput` (`RAFT_CHUNK:24366-24379`): singular or
 * plural header, the rendered bodies, the optional pending notice, the closing
 * line verbatim, and the response-target hint.
 */
export function formatWakeMessagesInput(input: {
  events: readonly WakeEvent[];
  notice?: WakeNoticeSummary | undefined;
  /** Appended after the hint; RAH's standing Activation contract. */
  activationInput?: string | undefined;
}): string {
  const messageCount = input.events.filter(
    (event) => event.type === "message.posted",
  ).length;
  const header =
    messageCount === 1 ? "New message received:" : "New messages received:";
  const rendered = input.events.map(formatWakeIncomingMessage).join("\n");
  const notice =
    input.notice === undefined ? "" : formatWakeInboxNotice(input.notice);
  const tail =
    input.activationInput === undefined || input.activationInput === ""
      ? ""
      : `\n\n${input.activationInput}`;
  return `${header}\n\n${rendered}${notice === "" ? "" : `\n\n${notice}`}\n\n${WAKE_CLOSING_LINE}\n${RESPONSE_TARGET_HINT}${tail}`;
}

/**
 * The whole range degraded, so there is no body to render. Raft's startup wake
 * does the same thing when a message carries no renderable context
 * (`RAFT_CHUNK:32431-32440`).
 */
export function formatWakeNoticeOnlyInput(input: {
  notice: WakeNoticeSummary;
  activationInput?: string | undefined;
}): string {
  const tail =
    input.activationInput === undefined || input.activationInput === ""
      ? ""
      : `\n\n${input.activationInput}`;
  return `${formatWakeInboxNotice(input.notice)}${tail}`;
}
