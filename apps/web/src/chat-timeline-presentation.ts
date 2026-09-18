import type { NavigationTarget, Principal, RoomEvent } from "@rah-os/protocol";
import type { RoomMessageView } from "@rah-os/ui-web";

export type ReminderReceiptPresentation = {
  createdAt: string;
  eventId: string;
  roomSeq: number;
  target: Extract<NavigationTarget, { kind: "message" }>;
  text: string;
};

export type ChatTimelineItem =
  | {
      createdAt: string;
      kind: "message";
      message: RoomMessageView;
      roomSeq: number;
    }
  | {
      createdAt: string;
      eventId: string;
      kind: "membership-added";
      participantId: string;
      roomSeq: number;
      text: string;
    }
  | {
      createdAt: string;
      eventId: string;
      kind: "archive-changed";
      roomSeq: number;
      text: string;
    }
  | (ReminderReceiptPresentation & { kind: "reminder-fired" });

export type ThreadReceiptTimelineItem =
  | {
      createdAt: string;
      kind: "message";
      message: RoomMessageView;
      roomSeq: number;
    }
  | (ReminderReceiptPresentation & { kind: "reminder-fired" });

export function buildChatTimeline({
  events,
  members,
  messages,
}: {
  events: readonly RoomEvent[];
  members: readonly Principal[];
  messages: readonly RoomMessageView[];
}): ChatTimelineItem[] {
  const handles = new Map(
    members.map((member) => [member.principalId, member.handle]),
  );
  const items: ChatTimelineItem[] = messages.map((message) => ({
    createdAt: message.createdAt,
    kind: "message",
    message,
    roomSeq: message.roomSeq,
  }));
  for (const event of events) {
    if (event.type === "room.archived" || event.type === "room.unarchived") {
      const archived = event.type === "room.archived";
      const actor = handles.get(event.actorId) ?? event.actorId;
      items.push({
        createdAt: event.createdAt,
        eventId: event.eventId,
        kind: "archive-changed",
        roomSeq: event.roomSeq,
        text: `${archived ? "📦" : "📤"} ${actor} ${archived ? "archived" : "unarchived"} this channel`,
      });
      continue;
    }
    if (event.type === "membership.added") {
      const participantId = event.payload.participantId;
      if (typeof participantId !== "string") continue;
      const handle = handles.get(participantId) ?? participantId;
      items.push({
        createdAt: event.createdAt,
        eventId: event.eventId,
        kind: "membership-added",
        participantId,
        roomSeq: event.roomSeq,
        text: `@${handle} was added to this channel.`,
      });
      continue;
    }
    const receipt = reminderReceipt(event);
    if (
      receipt === undefined ||
      (receipt.target.threadId !== undefined &&
        receipt.target.roomId === event.roomId)
    )
      continue;
    items.push({ ...receipt, kind: "reminder-fired" });
  }
  return items.sort(
    (left, right) =>
      left.roomSeq - right.roomSeq ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function threadReminderReceipts(
  events: readonly RoomEvent[],
  threadId: string | undefined,
): ReminderReceiptPresentation[] {
  if (threadId === undefined) return [];
  return events
    .flatMap((event) => {
      const receipt = reminderReceipt(event);
      return receipt !== undefined &&
        receipt.target.threadId === threadId &&
        receipt.target.roomId === event.roomId
        ? [receipt]
        : [];
    })
    .sort(
      (left, right) =>
        left.roomSeq - right.roomSeq ||
        left.createdAt.localeCompare(right.createdAt),
    );
}

export function buildThreadReceiptTimeline(
  messages: readonly RoomMessageView[],
  receipts: readonly ReminderReceiptPresentation[],
): ThreadReceiptTimelineItem[] {
  return [
    ...messages.map((message) => ({
      createdAt: message.createdAt,
      kind: "message" as const,
      message,
      roomSeq: message.roomSeq,
    })),
    ...receipts.map((receipt) => ({
      ...receipt,
      kind: "reminder-fired" as const,
    })),
  ].sort(
    (left, right) =>
      left.roomSeq - right.roomSeq ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

function reminderReceipt(
  event: RoomEvent,
): ReminderReceiptPresentation | undefined {
  if (event.type !== "reminder.fired") return undefined;
  const messageId = event.payload.messageId;
  const anchorRoomId = event.payload.anchorRoomId;
  const title = event.payload.title;
  if (
    typeof messageId !== "string" ||
    typeof anchorRoomId !== "string" ||
    typeof title !== "string"
  )
    return undefined;
  const threadId = event.payload.threadId;
  const rootMessageId = event.payload.rootMessageId;
  return {
    createdAt: event.createdAt,
    eventId: event.eventId,
    roomSeq: event.roomSeq,
    target: {
      kind: "message",
      messageId,
      roomId: anchorRoomId,
      ...(typeof threadId === "string" ? { threadId } : {}),
      ...(typeof rootMessageId === "string" ? { rootMessageId } : {}),
    },
    text: `提醒已触发：${title}`,
  };
}

function calendarParts(value: string | Date, timeZone?: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (timeZone === undefined) {
    return {
      day: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
    };
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(timeZone === undefined ? {} : { timeZone }),
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(typeof value === "string" ? new Date(value) : value)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year),
  };
}

export function chatLocalDateKey(value: string | Date, timeZone?: string) {
  const { day, month, year } = calendarParts(value, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Raft v3e: same calendar day omits the date; yesterday is a label. */
export function chatMessageDateLabel(
  createdAt: string,
  now = new Date(),
  timeZone?: string,
): string {
  if (Number.isNaN(new Date(createdAt).getTime())) return "";
  const then = calendarParts(createdAt, timeZone);
  const today = calendarParts(now, timeZone);
  const difference =
    (Date.UTC(today.year, today.month - 1, today.day) -
      Date.UTC(then.year, then.month - 1, then.day)) /
    86_400_000;
  if (difference === 0) return "";
  if (difference === 1) return "昨天";
  const date = `${String(then.month).padStart(2, "0")}/${String(then.day).padStart(2, "0")}`;
  return then.year === today.year ? date : `${then.year}/${date}`;
}

export function chatDateLabel(
  createdAt: string,
  now = new Date(),
  timeZone?: string,
) {
  const thenParts = calendarParts(createdAt, timeZone);
  const nowParts = calendarParts(now, timeZone);
  const thenDay = Date.UTC(thenParts.year, thenParts.month - 1, thenParts.day);
  const nowDay = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const dayDifference = Math.round((nowDay - thenDay) / 86_400_000);
  if (dayDifference === 0) return "今天";
  if (dayDifference === 1) return "昨天";
  const labelParts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", {
      day: "numeric",
      month: "numeric",
      weekday: "long",
      ...(timeZone === undefined ? {} : { timeZone }),
    })
      .formatToParts(new Date(createdAt))
      .map((part) => [part.type, part.value]),
  );
  return `${labelParts.month}月${labelParts.day}日${labelParts.weekday}`;
}

export function chatTimelineKey(item: ChatTimelineItem) {
  return item.kind === "message"
    ? item.message.messageId
    : `event:${item.eventId}`;
}
