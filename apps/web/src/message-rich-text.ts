import type {
  MessageReference,
  MessageMentionBinding,
  MessageReferenceReadState,
  ParticipantKind,
  RoomKind,
} from "@rah-os/protocol";
import {
  MessageReferenceSchema,
  messageMentionCandidates,
  messageReferenceNameKey,
} from "@rah-os/protocol";

export type MessageTextReferenceCatalog = {
  mentions?: readonly MessageMentionBinding[] | undefined;
  agents?: readonly {
    agentId: string;
    handle: string;
    principalId: string;
    readState?: MessageReferenceReadState;
  }[];
  computers?: readonly { hostId: string; names: readonly string[] }[];
  principals?: readonly {
    directRoomId?: string;
    kind: Extract<ParticipantKind, "agent" | "human">;
    handle: string;
    principalId: string;
    readState?: MessageReferenceReadState;
    self: boolean;
  }[];
  rooms?: readonly {
    kind: RoomKind;
    names: readonly string[];
    peerNames?: readonly string[];
    roomId: string;
  }[];
  tasks?: readonly {
    roomId: string;
    rootMessageId: string;
    taskId: string;
    taskNumber: number;
    threadId: string;
  }[];
  threads?: readonly {
    peerNames?: readonly string[];
    roomId: string;
    roomKind: RoomKind;
    roomName: string;
    rootMessageId: string;
    threadId: string;
  }[];
};

export type UnresolvedMessageReference = {
  candidateKind: "computer" | "message" | "room" | "task" | "thread";
  kind: "unresolved";
  taskNumber?: number;
  value: string;
};

export type MessageTextToken =
  | { kind: "text"; value: string }
  | MessageReference
  | UnresolvedMessageReference;

export type SearchTextSegment = { highlighted: boolean; value: string };

// Longer message/thread forms come first so a failed child identity never
// degrades into a clickable parent prefix.
const candidatePattern =
  /(?:dm:@[\p{L}\p{N}_.-]+|#[\p{L}\p{N}_-]+)(?::[a-z0-9_-]+)?(?:\s+msg=[a-z0-9_-]+)?|computer:[a-z0-9_-]+|app:[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+|(?:task\s+)#[1-9]\d*/giu;
const identifierCharacter = /[\p{L}\p{N}_-]/u;
const taskNumberPattern = /^(?:task\s+)?#([1-9]\d*)$/iu;
const messageSuffixPattern = /\s+msg=([a-z0-9_-]+)$/iu;
const appPattern = /^app:([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+)$/iu;

function key(value: string): string {
  return messageReferenceNameKey(value);
}

function appendText(tokens: MessageTextToken[], value: string): void {
  if (value === "") return;
  const previous = tokens.at(-1);
  if (previous?.kind === "text") previous.value += value;
  else tokens.push({ kind: "text", value });
}

function findByName<T extends { names: readonly string[] }>(
  values: readonly T[],
  name: string,
): T | undefined {
  const wanted = key(name);
  const matches = values.filter(({ names }) =>
    names.some((value) => key(value) === wanted),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function findRoom(
  rooms: readonly NonNullable<MessageTextReferenceCatalog["rooms"]>[number][],
  syntax: string,
) {
  if (syntax.startsWith("dm:@")) {
    const peer = syntax.slice(4);
    const matches = rooms.filter(
      ({ kind, peerNames = [] }) =>
        kind === "direct" && peerNames.some((name) => key(name) === key(peer)),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  const name = syntax.slice(1);
  const matches = rooms.filter(
    ({ kind, names }) =>
      kind !== "direct" &&
      names.some((candidate) => key(candidate) === key(name)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function findThread(
  threads: readonly NonNullable<
    MessageTextReferenceCatalog["threads"]
  >[number][],
  roomId: string,
  shortId: string,
) {
  const candidates = threads.filter(
    ({ roomId: candidateRoomId, threadId }) =>
      candidateRoomId === roomId &&
      (threadId === shortId ||
        threadId.startsWith(shortId) ||
        threadId.endsWith(shortId)),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function unresolved(
  candidateKind: UnresolvedMessageReference["candidateKind"],
  value: string,
  taskNumber?: number,
): UnresolvedMessageReference {
  return {
    candidateKind,
    kind: "unresolved",
    value,
    ...(taskNumber === undefined ? {} : { taskNumber }),
  };
}

function structuredRoomReference(
  candidate: string,
  catalog: MessageTextReferenceCatalog,
): MessageReference | UnresolvedMessageReference | undefined {
  const messageMatch = messageSuffixPattern.exec(candidate);
  const messageId = messageMatch?.[1];
  const stem = messageMatch
    ? candidate.slice(0, messageMatch.index)
    : candidate;
  const separator = stem.lastIndexOf(":");
  const directPrefix = stem.startsWith("dm:@");
  const hasThread = separator > (directPrefix ? 3 : 0);
  const roomSyntax = hasThread ? stem.slice(0, separator) : stem;
  const threadShortId = hasThread ? stem.slice(separator + 1) : undefined;
  const room = findRoom(catalog.rooms ?? [], roomSyntax);
  if (room === undefined)
    return directPrefix
      ? unresolved(
          messageId ? "message" : hasThread ? "thread" : "room",
          candidate,
        )
      : undefined;
  const thread =
    threadShortId === undefined
      ? undefined
      : findThread(catalog.threads ?? [], room.roomId, threadShortId);
  if (threadShortId !== undefined && thread === undefined)
    return unresolved(messageId ? "message" : "thread", candidate);
  if (messageId !== undefined)
    return {
      kind: "message",
      messageId,
      roomId: room.roomId,
      roomKind: room.kind,
      value: candidate,
      ...(thread === undefined
        ? {}
        : {
            rootMessageId: thread.rootMessageId,
            threadId: thread.threadId,
          }),
    };
  if (thread !== undefined)
    return {
      kind: "thread",
      roomId: room.roomId,
      roomKind: room.kind,
      rootMessageId: thread.rootMessageId,
      threadId: thread.threadId,
      value: candidate,
    };
  return {
    kind: "room",
    roomId: room.roomId,
    roomKind: room.kind,
    value: candidate,
  };
}

/**
 * Raft-compatible conservative recognition for rendered message text.
 * The Markdown owner calls this only for text nodes, so code and authored links
 * retain their literal contents. Canonical Message bodies are never rewritten.
 */
export function tokenizeMessageText(
  value: string,
  references: MessageTextReferenceCatalog,
): MessageTextToken[] {
  const tokens: MessageTextToken[] = [];
  let offset = 0;
  const candidates = [
    ...[...value.matchAll(candidatePattern)].flatMap((match) =>
      match.index === undefined
        ? []
        : [{ candidate: match[0], index: match.index }],
    ),
    ...messageMentionCandidates(
      value,
      references.mentions?.map((b) => b.handle) ?? [
        ...(references.agents ?? []).map(({ handle }) => handle),
        ...(references.principals ?? []).map(({ handle }) => handle),
      ],
    ).map(({ start, value: candidate }) => ({ candidate, index: start })),
  ].sort(
    (left, right) =>
      left.index - right.index ||
      right.candidate.length - left.candidate.length,
  );
  for (const { candidate, index } of candidates) {
    if (index < offset) continue;
    const previous = index === 0 ? "" : value[index - 1]!;
    const next = value[index + candidate.length] ?? "";
    const numeric = taskNumberPattern.exec(candidate);
    const blockedBoundary =
      previous !== "" &&
      (identifierCharacter.test(previous) ||
        (numeric !== null && previous === "/"));
    const blockedFollowingBoundary =
      next !== "" &&
      (identifierCharacter.test(next) ||
        (next === "." &&
          identifierCharacter.test(value[index + candidate.length + 1] ?? "")));
    if (blockedBoundary || blockedFollowingBoundary) continue;

    let token: MessageTextToken | undefined;
    if (candidate.startsWith("@")) {
      const name = candidate.slice(1);
      const binding = references.mentions?.find((b) => b.handle === name);
      const agentMatches = binding?.agentId
        ? [
            {
              agentId: binding.agentId,
              principalId: binding.principalId,
              readState: (references.agents ?? []).find(
                (a) => a.principalId === binding.principalId,
              )?.readState,
            },
          ]
        : references.mentions !== undefined
          ? []
          : (references.agents ?? []).filter(({ handle }) => handle === name);
      const principalMatches = (references.principals ?? []).filter((person) =>
        references.mentions === undefined
          ? person.handle === name
          : person.principalId === binding?.principalId,
      );
      if (agentMatches.length + principalMatches.length !== 1)
        token = undefined;
      else if (agentMatches[0] !== undefined) {
        const agent = agentMatches[0];
        token = {
          agentId: agent.agentId,
          kind: "agent",
          principalId: agent.principalId,
          ...(agent.readState === undefined
            ? {}
            : { readState: agent.readState }),
          self: false,
          value: candidate,
        };
      } else if (principalMatches[0] !== undefined) {
        const principal = principalMatches[0];
        token = {
          ...(principal.directRoomId === undefined
            ? {}
            : { directRoomId: principal.directRoomId }),
          kind: "human",
          principalId: principal.principalId,
          ...(principal.readState === undefined
            ? {}
            : { readState: principal.readState }),
          self: principal.self,
          value: candidate,
        };
      }
    } else if (numeric !== null) {
      const taskNumber = Number(numeric[1]);
      const task = (references.tasks ?? []).find(
        ({ taskNumber: candidateNumber }) => candidateNumber === taskNumber,
      );
      if (task !== undefined)
        token = {
          kind: "task",
          roomId: task.roomId,
          rootMessageId: task.rootMessageId,
          taskId: task.taskId,
          taskNumber,
          threadId: task.threadId,
          value: candidate,
        };
      else if (/^task\s+/iu.test(candidate))
        token = unresolved("task", candidate, taskNumber);
    } else if (candidate.startsWith("computer:")) {
      const name = candidate.slice("computer:".length);
      const computer = findByName(
        (references.computers ?? []).map((value) => ({
          ...value,
          names: [value.hostId, ...value.names],
        })),
        name,
      );
      token =
        computer === undefined
          ? unresolved("computer", candidate)
          : { hostId: computer.hostId, kind: "computer", value: candidate };
    } else {
      const app = appPattern.exec(candidate);
      token =
        app === null
          ? structuredRoomReference(candidate, references)
          : { appId: app[1]!, kind: "app", value: candidate };
    }
    if (token === undefined) continue;
    const parsed =
      token.kind === "unresolved"
        ? { data: token, success: true as const }
        : MessageReferenceSchema.safeParse(token);
    if (!parsed.success) continue;
    appendText(tokens, value.slice(offset, index));
    tokens.push(parsed.data);
    offset = index + candidate.length;
  }
  appendText(tokens, value.slice(offset));
  return tokens;
}

export function splitSearchText(
  value: string,
  query: string | undefined,
): SearchTextSegment[] {
  const needle = query?.trim();
  if (!needle) return [{ highlighted: false, value }];
  const lowerValue = value.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const segments: SearchTextSegment[] = [];
  let offset = 0;
  while (offset < value.length) {
    const index = lowerValue.indexOf(lowerNeedle, offset);
    if (index < 0) break;
    if (index > offset)
      segments.push({ highlighted: false, value: value.slice(offset, index) });
    segments.push({
      highlighted: true,
      value: value.slice(index, index + needle.length),
    });
    offset = index + needle.length;
  }
  if (offset < value.length)
    segments.push({ highlighted: false, value: value.slice(offset) });
  return segments.length === 0 ? [{ highlighted: false, value }] : segments;
}
