/**
 * Raft gives the Agent text, not "text with a JSON option": of its 80 CLI
 * commands 76 default to human-readable output and only 19 carry `--json` at
 * all (output/errors inventory 表三). The read family is what an Agent parses on
 * every turn, so this module ports Raft's own renderers for it rather than
 * inventing a layout:
 *
 * - `formatHistory` / `formatHistoryMessageLine` (`main.js@676014`/`@675977`)
 * - `formatMessages` / `formatMessageLine` (`main.js@675967`/`@675944`)
 * - the `message check` drain terminator (`main.js@729514`)
 * - `formatChannelMembers` (`main.js@675200`), `formatServerInfo` (`@674994`),
 *   `formatRuntimeContext` (`@674952`), `formatCurrentAgent` (`@674986`)
 * - `formatTaskList2` / `formatMyTaskList` (`main.js@677419`/`@677441`)
 * - `formatTaskHistory` (`main.js@677573`), `formatChannelInfo` (`@675084`)
 * - `formatVersionInfo` (`main.js@673345`), `formatPageFooter` (`@675170`)
 * - the Task mutation acknowledgements: `formatTasksCreated` (`@30201610`),
 *   `formatClaimResults` (`@30203619`), `formatTaskAssigned` (`@30205071`),
 *   `formatTaskUnclaimed` (`@30204972`), `formatTaskStatusUpdated`
 *   (`@30205235`), `formatTaskAmended` (`@30205804`), `formatTaskConverted`
 *   (`@30205418`) and `formatTaskDeleted` (`@30205339`)
 * - the reminder family: `formatReminder` (`@30419136`),
 *   `formatReminderScheduled` (`@30419620`), `formatReminderList` (`@30419909`),
 *   `formatReminderCanceled` (`@30420079`), `formatReminderSnoozed`
 *   (`@30420209`), `formatReminderUpdated` (`@30420412`), `formatReminderLog`
 *   (`@30420697`) and `formatReminderType` (`@30421062`)
 * - `formatChannelMuteResult` (`@30113763`), `formatSeq` (`@30113681`),
 *   `formatUnfollowThreadResult` (`@30129287`) and `message react`'s success
 *   line (`@32631422`)
 *
 * Two things are deliberately not copied, because copying them would take from
 * the Agent something RAH's ledger requires it to pass to a later command:
 *
 * 1. Raft prints 8-character short ids and resolves them server-side
 *    (`AMBIGUOUS_ID` exists for the collisions). RAH has no short-id resolver:
 *    `--message-id`, `--task-id`, `--assignee` and `--around` all take the
 *    canonical ledger id. Every id here is therefore printed in full.
 * 2. Raft addresses members by handle alone. RAH's `task-create --assignee`
 *    takes a participant id, so member lines keep `id=<participantId>`, and
 *    `attachment-publish --context-receipt` needs the receipt `room-read`
 *    issues, so that line is kept too.
 * 3. Raft's Task thread hints and its `task amend` line are addressed in RAH's
 *    own terms: `message-post --thread-id <threadId>` in place of
 *    `--target "#channel:<msg8>"`, and the amendment event's Room sequence in
 *    place of a Task revision counter RAH's projection does not carry.
 *
 * Both are declared in docs/product/raft-parity-registry.json under the
 * sqlite-ledger constraint. Everything else is the upstream line shape.
 */

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};
const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** `toLocalTime` (`main.js@675909`), verbatim. */
function toLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

const time = (value: unknown): string => {
  const iso = asString(value);
  return iso === undefined ? "-" : toLocalTime(iso);
};

/**
 * `formatAttachmentSuffix` (`main.js@675936`) with the RAH download command in
 * place of `raft attachment view`, and the RAH attachment field names.
 */
function formatAttachmentSuffix(attachments: unknown): string {
  const items = asArray(attachments);
  if (items.length === 0) return "";
  const rendered = items
    .map((item) => {
      const attachment = asRecord(item);
      return `${asString(attachment.filename) ?? "-"} (id:${
        asString(attachment.attachmentId) ?? "-"
      })`;
    })
    .join(", ");
  return ` [${items.length} attachment${
    items.length > 1 ? "s" : ""
  }: ${rendered} — use rah worker attachment-download to download]`;
}

/** `formatPageFooter` (`main.js@675170`), reduced to the one cursor RAH pages by. */
function formatPageFooter(command: string, nextCursor: unknown): string {
  const cursor = asString(nextCursor);
  return cursor === undefined ? "" : `\nMore: ${command} --cursor "${cursor}"`;
}

// ---------------------------------------------------------------- messages --

/** `formatHistoryMessageLine` (`main.js@675977`). */
function historyLine(message: Json, index: number, total: number): string {
  const header = [
    `${index + 1}/${total}`,
    `seq=${asNumber(message.roomSeq) ?? "-"}`,
    `msg=${asString(message.messageId) ?? "-"}`,
    `time=${time(message.createdAt)}`,
  ];
  const threadId = asString(message.threadId);
  if (threadId !== undefined) header.push(`threadId=${threadId}`);
  return `[${header.join(" ")}] @${
    asString(message.actorId) ?? "unknown"
  }: ${asString(message.body) ?? ""}${formatAttachmentSuffix(
    message.attachments,
  )}`;
}

/** `formatMessageLine` (`main.js@675944`): the RFC 5424-style message header. */
function messageLine(message: Json): string {
  const threadId = asString(message.threadId);
  const target = `${asString(message.roomId) ?? "-"}${
    threadId === undefined ? "" : `:${threadId}`
  }`;
  return `[target=${target} msg=${
    asString(message.messageId) ?? "-"
  } time=${time(message.createdAt)}] @${
    asString(message.actorId) ?? "unknown"
  }: ${asString(message.body) ?? ""}${formatAttachmentSuffix(
    message.attachments,
  )}`;
}

const seqBoundary = (messages: Json[], edge: "first" | "last") =>
  asNumber((edge === "first" ? messages[0] : messages.at(-1))?.roomSeq) ?? "-";

function seqRange(messages: Json[]): string {
  const first = seqBoundary(messages, "first");
  const last = seqBoundary(messages, "last");
  return first === last ? String(first) : `${first}-${last}`;
}

/**
 * `historyCursorText` (`main.js@676011`). The anchor is a message id rather than
 * a sequence because RAH's `--before`/`--after` take the canonical message id.
 */
const cursorText = (
  label: string,
  exists: boolean,
  flag: string,
  anchor: string,
) =>
  exists
    ? `${label} exist: --${flag} ${anchor}.`
    : `No ${label.toLowerCase()}.`;

/** `formatHistory` (`main.js@676014`). */
function renderHistory(result: Json): string {
  const messages = asArray(result.messages).map(asRecord);
  if (messages.length === 0) return "No messages in this channel.";
  const count = messages.length;
  const oldest = asString(messages[0]?.messageId) ?? "-";
  const newest = asString(messages.at(-1)?.messageId) ?? "-";
  const header = `Read window: ${count} returned, seq ${seqRange(
    messages,
  )}, oldest to newest. ${cursorText(
    "Older",
    result.olderCursor !== undefined,
    "before",
    oldest,
  )} ${cursorText("Newer", result.newerCursor !== undefined, "after", newest)}`;
  const body = messages
    .map((message, index) => historyLine(message, index, count))
    .join("\n");
  return `${header}\n\n${body}\n\nEnd of window: ${count}/${count} shown.`;
}

/** `formatMessages([message])` (`main.js@32628007` calls it with one message). */
function renderMessageResolve(result: Json): string {
  const lines = [messageLine(asRecord(result.message))];
  if (result.rootMessage !== undefined)
    lines.push("", "Thread root:", messageLine(asRecord(result.rootMessage)));
  return lines.join("\n");
}

// ------------------------------------------------------------------ events --

/**
 * `formatTaskHistory`'s event shape (`main.js@677573`) for every canonical Room
 * event, and the `formatMessageLine` shape for `message.posted`, so a delivered
 * message body is text on the line rather than a field inside JSON.
 */
function eventLines(event: Json): string[] {
  const payload = asRecord(event.payload);
  const actor = asString(event.actorId) ?? "unknown";
  if (event.type === "message.posted") {
    const threadId = asString(payload.threadId);
    const header = [
      `seq=${asNumber(event.roomSeq) ?? "-"}`,
      `msg=${asString(payload.messageId) ?? "-"}`,
      `time=${time(event.createdAt)}`,
      `type=${asString(event.type) ?? "-"}`,
    ];
    if (threadId !== undefined) header.push(`threadId=${threadId}`);
    const lines = [
      `[${header.join(" ")}] @${actor}: ${
        asString(payload.body) ?? ""
      }${formatAttachmentSuffix(payload.attachments)}`,
    ];
    const mentions = asArray(payload.recipients)
      .map(asRecord)
      .filter((recipient) => recipient.reason === "mention")
      .map((recipient) => `@${asString(recipient.participantId) ?? "unknown"}`);
    if (mentions.length > 0) lines.push(`  mentions: ${mentions.join(", ")}`);
    return lines;
  }
  return [
    `seq=${asNumber(event.roomSeq) ?? "-"} time=${
      asString(event.createdAt) ?? "-"
    } actor=@${actor} type=${asString(event.type) ?? "-"}`,
    `  ${JSON.stringify(payload)}`,
  ];
}

/** The already-presented ledger facts, stated rather than left to be parsed. */
function presentedContextLines(presentedContext: unknown): string[] {
  const context = asRecord(presentedContext);
  const lines: string[] = [];
  for (const item of asArray(context.targets).map(asRecord)) {
    const threadId = asString(item.threadId);
    lines.push(
      `Already presented: target ${asString(item.roomId) ?? "-"}${
        threadId === undefined ? "" : `:${threadId}`
      } through seq ${asNumber(item.presentedThroughSeq) ?? "-"}.`,
    );
  }
  for (const item of asArray(context.events).map(asRecord)) {
    const responded = asRecord(item.respondedAfter);
    const ids = asArray(responded.messageIds)
      .map((value) => asString(value) ?? "-")
      .join(", ");
    lines.push(
      `Already presented: seq ${asNumber(item.roomSeq) ?? "-"} (msg=${
        asString(item.messageId) ?? "-"
      }) was already presented through seq ${
        asNumber(item.presentedThroughSeq) ?? "-"
      }; you posted ${asNumber(responded.count) ?? 0} message(s) at that target afterwards${
        ids === "" ? "" : ` (${ids})`
      }.`,
    );
  }
  return lines;
}

/**
 * `message check` (`main.js@729514`): the rendered window followed by the drain
 * terminator, so the Agent can tell when to stop draining. `formatMessages`'s
 * own empty sentence is kept verbatim.
 */
function renderSync(result: Json): string {
  const events = asArray(result.events).map(asRecord);
  const cursorAfter = asNumber(result.cursorAfter);
  const latest = asNumber(result.latestRoomSeq);
  const seqs = events.map((event) => asNumber(event.roomSeq) ?? "-");
  const range =
    events.length === 0
      ? undefined
      : seqs[0] === seqs.at(-1)
        ? String(seqs[0])
        : `${seqs[0]}-${seqs.at(-1)}`;
  // The cursor is stated on every run, empty window included: unlike Raft's
  // `message check`, which acks the drained seqs itself, RAH's Agent has to
  // pass the delivered cursor to `acknowledge --through-seq`.
  const sections: string[] = [
    `Sync window: ${events.length} delivered${
      range === undefined ? "" : `, seq ${range}`
    }, cursor ${asNumber(result.cursorBefore) ?? "-"} to ${
      cursorAfter ?? "-"
    } of ${latest ?? "-"}${events.length === 0 ? "." : ", oldest to newest."}`,
    events.length === 0
      ? "No new inbox messages."
      : events.flatMap((event) => eventLines(event)).join("\n"),
  ];
  const presented = presentedContextLines(result.presentedContext);
  if (presented.length > 0) sections.push(presented.join("\n"));
  sections.push(
    cursorAfter !== undefined && latest !== undefined && cursorAfter < latest
      ? "More messages are pending. Run `rah worker sync` again."
      : "No more new inbox messages.",
  );
  return sections.join("\n\n");
}

/** `formatHistory`'s window frame applied to `room-read`'s delivered events. */
function renderRoomRead(result: Json): string {
  const window = asRecord(result.window);
  const events = asArray(window.events).map(asRecord);
  const header = [
    `Read window: ${events.length} delivered at ${
      asString(result.roomId) ?? "-"
    }${
      asString(result.threadId) === undefined
        ? ""
        : `:${asString(result.threadId)}`
    }, seq ${asNumber(result.eventFloorSeq) ?? "-"}-${
      asNumber(result.throughRoomSeq) ?? "-"
    }, ${result.complete === true ? "complete" : "truncated"}, oldest to newest.`,
  ];
  const snapshot = asRecord(window.snapshot);
  if (window.snapshot !== null && window.snapshot !== undefined)
    header.push(
      `Room snapshot at seq ${
        asNumber(window.snapshotSeq) ?? "-"
      }: ${asArray(snapshot.members).length} member(s).`,
    );
  const receipt = asString(result.contextReceipt);
  if (receipt !== undefined) header.push(`Context receipt: ${receipt}`);
  const sections = [header.join("\n")];
  sections.push(
    events.length === 0
      ? "No messages in this channel."
      : events.flatMap((event) => eventLines(event)).join("\n"),
  );
  const threadContext = asRecord(result.threadContext);
  if (threadContext.history !== undefined)
    sections.push(
      "Thread context:",
      renderHistory(asRecord(threadContext.history)),
    );
  sections.push(`End of window: ${events.length}/${events.length} shown.`);
  return sections.join("\n\n");
}

// ------------------------------------------------------------------ rosters --

/** `agentStatusLabel` (`main.js@674979`) over the RAH AgentDefinition state. */
const memberStatus = (member: Json) => {
  const state = asString(member.agentState);
  return state === undefined ? "" : ` (${state})`;
};

function memberLine(member: Json): string {
  const principal = asRecord(member.principal);
  const description = asString(member.description);
  return `  - @${asString(principal.handle) ?? "unknown"}${memberStatus(
    member,
  )} id=${asString(principal.principalId) ?? "-"}${
    description === undefined ? "" : ` — ${description}`
  }`;
}

const ROLE_NOTE =
  "Role labels show server-level owner/admin authority; no role label means ordinary member.";

function memberSections(members: Json[]): string {
  let text = "";
  for (const [heading, kind] of [
    ["Agents", "agent"],
    ["Humans", "human"],
    ["Services", "service"],
  ] as const) {
    const rows = members.filter(
      (member) => asRecord(member.principal).kind === kind,
    );
    if (kind === "service" && rows.length === 0) continue;
    text += `### ${heading}\n${ROLE_NOTE}\n`;
    text +=
      rows.length > 0
        ? `${rows.map((member) => memberLine(member)).join("\n")}\n`
        : "  (none)\n";
    text += "\n";
  }
  return text;
}

/** `formatChannelMembers` (`main.js@675200`). */
function renderMembers(result: Json): string {
  let text = "## Channel Members\n\n";
  text += `Channel: ${asString(result.roomId) ?? "(unknown)"}\n`;
  text += "Members means join/post authority for this surface.\n\n";
  text += memberSections(asArray(result.members).map(asRecord));
  return `${text.trimEnd()}\n${formatPageFooter(
    "rah worker room-members",
    result.nextCursor,
  )}`;
}

/** `channelRef` (`main.js@675050`) over the RAH Room projection. */
function roomRef(room: Json): string {
  const name = asString(room.slug) ?? asString(room.name) ?? "unknown";
  return room.kind === "direct" ? `dm:@${name}` : `#${name}`;
}

/** `channelStatus` (`main.js@675064`). */
function roomStatus(room: Json, attention: Json, joined: boolean): string {
  const parts = [
    room.visibility === "private" || room.kind === "direct"
      ? "private"
      : "public",
    joined ? "joined" : "not joined",
  ];
  if (typeof attention.activityMuted === "boolean")
    parts.push(attention.activityMuted ? "muted" : "not muted");
  if (room.archivedAt !== undefined) parts.push("archived");
  return parts.join(", ");
}

function roomLine(room: Json, attention: Json, joined: boolean): string {
  const description = asString(room.description);
  // `formatChannelInfo` prints the channel's own `ID:` line (`main.js@675084`);
  // RAH keeps it inline because a message line addresses the same Room by id.
  return `  - ${roomRef(room)} [${roomStatus(room, attention, joined)}] id=${
    asString(room.roomId) ?? "-"
  }${description === undefined ? "" : ` — ${description}`}`;
}

/** `formatRuntimeContext` (`main.js@674952`) over the RAH runtime profile. */
function runtimeContextSection(runtimeContext: unknown): string {
  if (runtimeContext === undefined) return "";
  const context = asRecord(runtimeContext);
  const principal = asRecord(context.principal);
  const lines = [
    "### Current Runtime",
    "Authoritative context for this agent process. Do not infer computer identity from hostname or cwd when this section is present.",
  ];
  const agentId = asString(principal.principalId);
  if (agentId !== undefined) lines.push(`- Agent ID: ${agentId}`);
  const handle = asString(principal.handle);
  if (handle !== undefined) lines.push(`- Handle: @${handle}`);
  const state = asString(context.agentState);
  if (state !== undefined) lines.push(`- State: ${state}`);
  return lines.length > 2 ? `${lines.join("\n")}\n\n` : "";
}

/** `formatServerInfo` (`main.js@674994`), room-scoped as RAH's route is. */
function renderServerInfo(result: Json): string {
  let text = "## Server\n\n";
  text += runtimeContextSection(result.runtimeContext);
  const self = asString(result.selfParticipantId);
  if (self !== undefined)
    text += `### Current Agent\n- Participant: ${self}\n\n`;
  text += "### Rooms\n";
  text +=
    "Use the room reference as `--target`. Private rooms are shown only when you are a member; do not disclose private-room names, membership, or content outside that room. Run any subcommand with `--help` for syntax.\n";
  text += `${roomLine(asRecord(result.room), {}, true)}\n\n`;
  text += memberSections(asArray(result.members).map(asRecord));
  return `${text.trimEnd()}\n${formatPageFooter(
    "rah worker server-info",
    result.nextCursor,
  )}`;
}

/** `formatServerInfo`'s `### Channels` block, as its own listing. */
function renderRoomList(result: Json): string {
  const rooms = asArray(result.rooms).map(asRecord);
  const body =
    rooms.length > 0
      ? rooms
          .map((entry) =>
            roomLine(asRecord(entry.room), asRecord(entry.attention), true),
          )
          .join("\n")
      : "  (none)";
  return `## Rooms\n\n${body}\n${formatPageFooter(
    "rah worker room-list",
    result.nextCursor,
  )}`;
}

// ------------------------------------------------------------------- tasks --

const taskStatus = (task: Json) =>
  asString(task.workflowStatus) ?? asString(task.state) ?? "unknown";

/** `formatTaskList2` (`main.js@677419`). */
function taskBoardLine(task: Json): string {
  const assigneeId = asString(task.assigneeId);
  const assignee = assigneeId === undefined ? "" : ` → @${assigneeId}`;
  const creatorId = asString(task.creatorId);
  const creator = creatorId === undefined ? "" : ` (by @${creatorId})`;
  const messageId = asString(task.sourceMessageId);
  const message = messageId === undefined ? "" : ` msg=${messageId}`;
  const description = asString(task.description);
  const details =
    description === undefined
      ? ""
      : `\n  details: ${description.replaceAll("\n", "\n           ")}`;
  return `#${asNumber(task.taskNumber) ?? "?"} [${taskStatus(task)}] ${
    asString(task.title) ?? ""
  }${assignee}${creator}${message} id=${
    asString(task.taskId) ?? "-"
  }${details}`;
}

/** `formatMyTaskList`'s row (`main.js@677441`), keyed by the RAH Room id. */
function myTaskLine(task: Json): string {
  const creatorId = asString(task.creatorId);
  const messageId = asString(task.sourceMessageId);
  return `- ${asString(task.roomId) ?? "-"} task #${
    asNumber(task.taskNumber) ?? "?"
  } [${taskStatus(task)}]${creatorId === undefined ? "" : ` by=@${creatorId}`}${
    messageId === undefined ? "" : ` msg=${messageId}`
  } id=${asString(task.taskId) ?? "-"} ${(
    asString(task.title) ?? ""
  ).replaceAll(/\s+/gu, " ")}`.trimEnd();
}

function renderTaskList(body: Json, result: Json): string {
  const tasks = asArray(result.tasks).map(asRecord);
  const status = asString(body.status);
  const mine = body.mine === true;
  const target = asString(body.channel) ?? "this Room";
  if (tasks.length === 0)
    return mine
      ? `No${status === undefined ? " unfinished" : ` ${status}`} tasks assigned to you.`
      : `No${status === undefined ? "" : ` ${status}`} tasks in ${target}.`;
  const listing = mine
    ? `## My assigned tasks${
        status === undefined ? " (unfinished)" : ` (status=${status})`
      }\n\n${tasks.map((task) => myTaskLine(task)).join("\n")}`
    : `## Task Board for ${target} (${tasks.length} tasks)\n\n${tasks
        .map((task) => taskBoardLine(task))
        .join("\n")}`;
  return `${listing}${formatPageFooter(
    "rah worker task-list",
    result.nextCursor,
  )}`;
}

/** `formatTaskHistory` (`main.js@677573`). */
function renderTaskHistory(result: Json): string {
  const header = `## Task ${asString(result.taskId) ?? "-"} history`;
  const events = asArray(result.events).map(asRecord);
  if (events.length === 0) return `${header}\n\nNo recorded events.`;
  const rendered = events
    .map((event) => {
      const { actorId, createdAt, eventId, roomSeq, type, ...rest } = event;
      void eventId;
      return `seq=${asNumber(roomSeq) ?? "-"} time=${
        asString(createdAt) ?? "-"
      } actor=@${asString(actorId) ?? "unknown"} type=${
        asString(type) ?? "-"
      }\n  ${JSON.stringify(rest)}`;
    })
    .join("\n");
  return `${header}\n\n${rendered}${formatPageFooter(
    "rah worker task-history",
    result.nextCursor,
  )}`;
}

/** `formatChannelInfo`'s key-line block (`main.js@675084`), over one Task. */
function renderTaskGet(result: Json): string {
  const task = asRecord(result.task);
  const lines = [`## Task #${asNumber(task.taskNumber) ?? "?"}`, ""];
  const push = (label: string, value: unknown) => {
    const text =
      typeof value === "string"
        ? value
        : Array.isArray(value) && value.length > 0
          ? value.join(", ")
          : undefined;
    if (text !== undefined && text !== "") lines.push(`${label}: ${text}`);
  };
  push("Title", task.title);
  push("ID", task.taskId);
  push("Room", task.roomId);
  push("Status", taskStatus(task));
  push("State", task.state);
  const assigneeId = asString(task.assigneeId);
  lines.push(
    `Assignee: ${assigneeId === undefined ? "(unassigned)" : `@${assigneeId}`}`,
  );
  push("Creator", asString(task.creatorId) && `@${asString(task.creatorId)}`);
  push(
    "Claimed by",
    asString(task.claimedBy) && `@${asString(task.claimedBy)}`,
  );
  push(
    "Reviewers",
    asArray(task.reviewerIds).map((id) => `@${String(id)}`),
  );
  push(
    "Collaborators",
    asArray(task.collaboratorIds).map((id) => `@${String(id)}`),
  );
  push(
    "Depends on",
    asArray(task.dependencyTaskIds).map((id) => String(id)),
  );
  push("Source message", task.sourceMessageId);
  push("Thread", task.threadId);
  push("Blocked reason", task.blockedReason);
  push("Last progress", task.lastProgress);
  push("Submission summary", task.submissionSummary);
  push("Created", task.createdAt);
  push("Updated", task.updatedAt);
  const description = asString(task.description);
  if (description !== undefined)
    lines.push(
      "",
      "details:",
      ...description.split("\n").map((line) => `  ${line}`),
    );
  return lines.join("\n");
}

/** `formatTaskAmended`'s detail block (`main.js@677564`), over one submission. */
function renderTaskSubmission(result: Json): string {
  const submission = asRecord(result.submission);
  const lines = [
    `## Task submission #${asNumber(submission.submissionNumber) ?? "?"}`,
    "",
    `Task: ${asString(submission.taskId) ?? "-"}`,
    `Submission: ${asString(submission.submissionId) ?? "-"}`,
    `Producer: @${asString(submission.producerId) ?? "unknown"}`,
    `Message: ${asString(submission.messageId) ?? "-"}`,
    `Digest: ${asString(submission.submissionDigest) ?? "-"}`,
    `Created: ${asString(submission.createdAt) ?? "-"}`,
  ];
  const evidence = asRecord(submission.evidence);
  const verification = asString(evidence.verificationStatus);
  if (verification !== undefined)
    lines.push(
      `Verification: ${verification}`,
      ...[
        asString(evidence.verificationSummary) === undefined
          ? []
          : [`  ${asString(evidence.verificationSummary)}`],
      ].flat(),
    );
  const artifacts = asArray(submission.artifacts).map(asRecord);
  if (artifacts.length > 0) {
    lines.push("", `Artifacts (${artifacts.length}):`);
    for (const artifact of artifacts)
      lines.push(
        `  #${asNumber(artifact.ordinal) ?? "?"} ${
          asString(artifact.filename) ?? "-"
        } (id:${asString(artifact.attachmentId) ?? "-"})`,
      );
  }
  lines.push(
    "",
    "Summary:",
    ...(asString(submission.summary) ?? "")
      .split("\n")
      .map((line) => `  ${line}`),
  );
  return lines.join("\n");
}

function renderInputStatus(result: Json): string {
  if (result.inputRequest === null || result.inputRequest === undefined)
    return "No input request is open for this task.";
  const request = asRecord(result.inputRequest);
  return `Input request ${asString(request.inputRequestId) ?? "-"} for task ${
    asString(request.taskId) ?? "-"
  } is ${asString(request.state) ?? "unknown"}.`;
}

// -------------------------------------------------------- task mutations --

/**
 * The Task line `formatTasksCreated` prints for each created Task
 * (`main.js@30201610`). Upstream shows `claimedAt`; RAH's ledger records the
 * lease bound instead, so the field is named for what it holds. There is no
 * `--creates-resource` gate in RAH, so the resource-receipt suffix has no
 * counterpart to print.
 */
function createdTaskLine(task: Json): string {
  const assigneeId = asString(task.assigneeId);
  return `#${asNumber(task.taskNumber) ?? "?"} [${taskStatus(task)}] assignee=${
    assigneeId === undefined ? "unassigned" : `@${assigneeId}`
  } claimUntil=${asString(task.claimUntil) ?? "null"} msg=${
    asString(task.sourceMessageId) ?? "-"
  } "${asString(task.title) ?? ""}"`;
}

/**
 * `formatTasksCreated`'s thread hint (`main.js@30201610`) in RAH's own address
 * form: upstream follows up with `--target "#channel:<msg8>"`, RAH's
 * `message-post` addresses the same Thread by its canonical id.
 */
function threadHintLine(task: Json): string {
  return `#${asNumber(task.taskNumber) ?? "?"} → rah worker message-post --thread-id ${
    asString(task.threadId) ?? "-"
  }`;
}

/** `formatTasksCreated` (`main.js@30201610`) over the one Task RAH creates. */
function renderTaskCreated(result: Json): string {
  const task = asRecord(result.task);
  return [
    `Created 1 task(s) in ${asString(task.roomId) ?? "this Room"}:`,
    createdTaskLine(task),
    "",
    "To follow up in each task's thread:",
    threadHintLine(task),
  ].join("\n");
}

/**
 * `formatClaimResults` (`main.js@30203619`). RAH sends one request per claimed
 * Task, so the successful rows are gathered and rendered as the one result
 * block Raft writes. A failed claim is a raised error on RAH's side and never
 * reaches this renderer, so the failure rows have no counterpart here.
 */
export function renderWorkerTaskClaimResults(
  results: readonly unknown[],
): string {
  const tasks = results.map((entry) => asRecord(asRecord(entry).task));
  const lines = tasks.map(
    (task) =>
      `#${asNumber(task.taskNumber) ?? "?"} (msg:${
        asString(task.sourceMessageId) ?? "-"
      }): claimed`,
  );
  const hints = tasks.map((task) => threadHintLine(task)).join("\n");
  return `Claim results (${tasks.length} claimed):\n${lines.join(
    "\n",
  )}\n\nFollow up in each task's thread:\n${hints}`;
}

/** `formatTaskAssigned` (`main.js@30205071`). */
function renderTaskAssigned(result: Json): string {
  const task = asRecord(result.task);
  const assigneeId = asString(task.assigneeId);
  const number = asNumber(task.taskNumber) ?? "?";
  return assigneeId === undefined
    ? `#${number} unassigned — now open.`
    : `#${number} assigned to @${assigneeId}.`;
}

/** `formatTaskUnclaimed` (`main.js@30204972`), which is Raft's `task unclaim`. */
function renderTaskReleased(result: Json): string {
  return `#${asNumber(asRecord(result.task).taskNumber) ?? "?"} unclaimed — now open.`;
}

/** `formatTaskStatusUpdated` (`main.js@30205235`), which is Raft's `task update`. */
function renderTaskStatusUpdated(result: Json): string {
  const task = asRecord(result.task);
  return `#${asNumber(task.taskNumber) ?? "?"} moved to ${taskStatus(task)}.`;
}

/**
 * `formatTaskAmended` (`main.js@30205804`). Upstream names the Task revision;
 * RAH's Task projection carries no revision counter, so the amendment is
 * identified by the Room sequence of the event that recorded it, which is the
 * ledger fact `task-history` shows for the same amendment.
 */
function renderTaskAmended(result: Json): string {
  const task = asRecord(result.task);
  const description = asString(task.description);
  return [
    `#${asNumber(task.taskNumber) ?? "?"} amended — event seq ${
      asNumber(asRecord(result.event).roomSeq) ?? "-"
    }.`,
    `title: ${asString(task.title) ?? ""}`,
    description === undefined
      ? "details: <none>"
      : `details:\n${description
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")}`,
  ].join("\n");
}

/** `formatTaskConverted` (`main.js@30205418`). */
function renderTaskConverted(result: Json): string {
  const task = asRecord(result.task);
  const assigneeId = asString(task.assigneeId);
  return [
    `Converted msg=${asString(task.sourceMessageId) ?? "-"} to task #${
      asNumber(task.taskNumber) ?? "?"
    } [${taskStatus(task)}] assignee=${
      assigneeId === undefined ? "unassigned" : `@${assigneeId}`
    } "${asString(task.title) ?? ""}"`,
    "",
    "To follow up in the task's thread:",
    `rah worker message-post --thread-id ${asString(task.threadId) ?? "-"}`,
  ].join("\n");
}

/** `formatTaskDeleted` (`main.js@30205339`). */
function renderTaskDeleted(result: Json): string {
  return `#${asNumber(result.taskNumber) ?? "?"} deleted.`;
}

// ------------------------------------------------------------- reminders --

/** `MODIFY_HINT` (`main.js@32736620`), with RAH's command name. */
const REMINDER_MODIFY_HINT =
  "(to modify: snooze/update/cancel; rah reminder --help)";

/** `formatReminderType` (`main.js@30421062`). */
function reminderType(reminder: Json): string {
  const recurrence = asRecord(reminder.recurrence);
  const description = asString(recurrence.description);
  return description === undefined
    ? "(one-time)"
    : `(recurring · ${description})`;
}

/**
 * `formatReminder` (`main.js@30419136`). Upstream slices the reminder id to
 * eight characters and resolves it server-side; RAH's `--id` takes the
 * canonical ledger id, so the id is printed in full.
 */
function reminderLine(reminder: Json, now: Date): string {
  const status = asString(reminder.status) ?? "unknown";
  const fireAt = asString(reminder.fireAt);
  const timeField =
    status === "fired"
      ? `fired_at=${asString(reminder.firedAt) ?? fireAt ?? "-"}`
      : `next=${fireAt ?? "-"}`;
  const fireAtMs = fireAt === undefined ? Number.NaN : Date.parse(fireAt);
  const overdue =
    status === "scheduled" &&
    Number.isFinite(fireAtMs) &&
    fireAtMs < now.getTime();
  const messageId = asString(reminder.msgId);
  return `#${asString(reminder.reminderId) ?? "-"} [${status}] ${reminderType(
    reminder,
  )} ${timeField}${overdue ? " OVERDUE" : ""} "${
    asString(reminder.title) ?? ""
  }"${messageId === undefined ? "" : ` ref=${messageId}`}`;
}

/** `formatReminderList` (`main.js@30419909`). */
function renderReminderList(result: Json, now: Date): string {
  const reminders = asArray(result.reminders).map(asRecord);
  if (reminders.length === 0) return "No reminders.";
  return reminders.map((reminder) => reminderLine(reminder, now)).join("\n");
}

/**
 * `formatReminderScheduled` / `formatReminderSnoozed` / `formatReminderUpdated`
 * (`main.js@30419620`, `@30420209`, `@30420412`): one headline, the next fire
 * time and the modify hint. Raft's optional `Warning:` line reports a timezone
 * its own scheduler could not honour; RAH's scheduler rejects that input
 * instead of accepting it with a warning, so there is no line to print.
 */
function reminderConfirmation(headline: string, reminder: Json): string {
  return [
    `${headline}: #${asString(reminder.reminderId) ?? "-"} ${reminderType(
      reminder,
    )} "${asString(reminder.title) ?? ""}"`,
    `Next: ${asString(reminder.fireAt) ?? "-"}`,
    REMINDER_MODIFY_HINT,
  ].join("\n");
}

/** `formatReminderCanceled` (`main.js@30420079`). */
function renderReminderCanceled(reminder: Json): string {
  return `Reminder canceled: #${asString(reminder.reminderId) ?? "-"} [${
    asString(reminder.status) ?? "unknown"
  }] "${asString(reminder.title) ?? ""}"`;
}

/** `formatReminderLog` (`main.js@30420697`). */
function renderReminderLog(result: Json): string {
  const events = asArray(result.events).map(asRecord);
  if (events.length === 0) return "No reminder events.";
  return events
    .map((event) => {
      const actorId = asString(event.actorId);
      const nextFireAt = asString(event.nextFireAt);
      return `${asString(event.occurredAt) ?? "-"} ${(
        asString(event.eventType) ?? "unknown"
      ).toUpperCase()} by ${asString(event.actorType) ?? "unknown"}${
        actorId === undefined ? "" : `:${actorId}`
      } next=${nextFireAt ?? "none"}`;
    })
    .join("\n");
}

// ----------------------------------------------------- channel attention --

/** `formatSeq` (`main.js@30113681`). */
const formatSeq = (value: unknown) =>
  value === null || value === undefined ? "none" : String(value);

/**
 * `formatChannelMuteResult` (`main.js@30113763`). Upstream's `attention` block
 * is server-authored guidance that RAH's response does not carry, so only the
 * three lines it always writes have a counterpart here.
 */
function renderChannelAttention(body: Json, result: Json): string {
  const target =
    asString(body.channel) ?? asString(result.roomId) ?? "this Room";
  const muted = result.activityMuted === true;
  return [
    `${muted ? "Muted" : "Unmuted"} ${target}.`,
    `Activity muted: ${muted ? "yes" : "no"}`,
    `Mute from seq: ${formatSeq(result.muteFromSeq)}`,
  ].join("\n");
}

/** `formatUnfollowThreadResult` (`main.js@30129287`), with RAH's command name. */
function renderThreadUnfollow(body: Json, result: Json): string {
  const target =
    asString(body.channel) ?? asString(result.threadId) ?? "this thread";
  return [
    `Unfollowed ${target}. Ordinary delivery for this thread has stopped.`,
    `A later personal @mention arrives and re-follows you; that delivery reminds you to run: rah worker thread-unfollow --target ${JSON.stringify(
      target,
    )}`,
    "Posting in this thread re-follows you automatically.",
  ].join("\n");
}

/**
 * `raft message react`'s success line (`main.js@32631422`). Upstream slices the
 * message id to eight characters; RAH prints the canonical id its own
 * `--message-id` takes.
 */
function renderMessageReaction(body: Json, result: Json): string {
  const emoji = asString(body.emoji) ?? "-";
  const verb = body.active === false ? "removed from" : "added to";
  return `Reaction ${emoji} ${verb} message ${
    asString(result.messageId) ?? asString(body.messageId) ?? "-"
  }.`;
}

/** `formatVersionInfo` (`main.js@673345`). */
function renderVersion(result: Json): string {
  const carrier = asRecord(result.cliCarrier);
  return [
    `RAH CLI: ${asString(carrier.name) ?? "unknown"} ${
      asString(carrier.version) ?? "unknown"
    }`,
    `RAH daemon (live): ${asString(result.buildVersion) ?? "not present"}`,
    `Worker protocol (live): ${asNumber(result.protocolVersion) ?? "not present"}`,
  ].join("\n");
}

/**
 * The renderer table. A path with no entry keeps its JSON response: this batch
 * moved the read family, and `whoami` stays JSON because Raft's `whoami` is one
 * of the four commands that call `writeJson` unconditionally (`main.js@32532731`).
 */
const RENDERERS: Record<string, (body: Json, result: Json) => string> = {
  "/v1/worker/channels/mute": renderChannelAttention,
  "/v1/worker/channels/unmute": renderChannelAttention,
  "/v1/worker/messages/history": (_body, result) => renderHistory(result),
  "/v1/worker/messages/react": renderMessageReaction,
  "/v1/worker/messages/resolve": (_body, result) =>
    renderMessageResolve(result),
  "/v1/worker/reminders/cancel": (_body, result) =>
    renderReminderCanceled(asRecord(result.reminder)),
  "/v1/worker/reminders/list": (_body, result) =>
    renderReminderList(result, new Date()),
  "/v1/worker/reminders/log": (_body, result) => renderReminderLog(result),
  "/v1/worker/reminders/schedule": (_body, result) =>
    reminderConfirmation("Reminder scheduled", asRecord(result.reminder)),
  "/v1/worker/reminders/snooze": (_body, result) =>
    reminderConfirmation("Reminder snoozed", asRecord(result.reminder)),
  "/v1/worker/reminders/update": (_body, result) =>
    reminderConfirmation("Reminder updated", asRecord(result.reminder)),
  "/v1/worker/room/members": (_body, result) => renderMembers(result),
  "/v1/worker/rooms/list": (_body, result) => renderRoomList(result),
  "/v1/worker/rooms/read": (_body, result) => renderRoomRead(result),
  "/v1/worker/server/info": (_body, result) => renderServerInfo(result),
  "/v1/worker/sync": (_body, result) => renderSync(result),
  "/v1/worker/tasks/amend": (_body, result) => renderTaskAmended(result),
  "/v1/worker/tasks/assign": (_body, result) => renderTaskAssigned(result),
  "/v1/worker/tasks/block": (_body, result) => renderTaskStatusUpdated(result),
  "/v1/worker/tasks/claim": (_body, result) =>
    renderWorkerTaskClaimResults([result]),
  "/v1/worker/tasks/claim-message": (_body, result) =>
    renderWorkerTaskClaimResults([result]),
  "/v1/worker/tasks/convert": (_body, result) => renderTaskConverted(result),
  "/v1/worker/tasks/create": (_body, result) => renderTaskCreated(result),
  "/v1/worker/tasks/delete": (_body, result) => renderTaskDeleted(result),
  "/v1/worker/tasks/get": (_body, result) => renderTaskGet(result),
  "/v1/worker/tasks/history": (_body, result) => renderTaskHistory(result),
  "/v1/worker/tasks/input-status": (_body, result) => renderInputStatus(result),
  "/v1/worker/tasks/list": renderTaskList,
  "/v1/worker/tasks/progress": (_body, result) =>
    renderTaskStatusUpdated(result),
  "/v1/worker/tasks/release": (_body, result) => renderTaskReleased(result),
  "/v1/worker/tasks/request-input": (_body, result) =>
    renderTaskStatusUpdated(result),
  "/v1/worker/tasks/review": (_body, result) => renderTaskStatusUpdated(result),
  "/v1/worker/tasks/start": (_body, result) => renderTaskStatusUpdated(result),
  "/v1/worker/tasks/submission": (_body, result) =>
    renderTaskSubmission(result),
  "/v1/worker/tasks/submit": (_body, result) => renderTaskStatusUpdated(result),
  "/v1/worker/tasks/unblock": (_body, result) =>
    renderTaskStatusUpdated(result),
  "/v1/worker/threads/unfollow": renderThreadUnfollow,
  "/v1/worker/version": (_body, result) => renderVersion(result),
};

/**
 * The rendered text for one read command, or `undefined` when the command has
 * no ported renderer and keeps its JSON response.
 */
export function renderWorkerReadResult(
  path: string,
  body: unknown,
  result: unknown,
): string | undefined {
  return RENDERERS[path]?.(asRecord(body), asRecord(result));
}

/** Whether `--json` exists on the command behind this path, as it does upstream. */
export function workerReadCommandOffersJson(path: string): boolean {
  // `version` is one of Raft's 19 `--json` commands (`main.js@32534037`); none
  // of the other read commands ported here carries the flag upstream.
  return path === "/v1/worker/version";
}
