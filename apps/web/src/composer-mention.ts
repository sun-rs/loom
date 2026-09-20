import { rankComposerSuggestions } from "./composer-suggestion-ranking.ts";
import {
  messageMentionQueryAt,
  visibleMessageText,
  type MessageMentionQuery,
} from "@rah-os/protocol";

export type ComposerMentionAgent = {
  description?: string | undefined;
  sourceServerLabel?: string | undefined;
  displayName: string;
  handle: string;
  participantId: string;
};

export type ComposerMentionMatch = MessageMentionQuery;

/** Locate the unfinished @token containing the caret. Message parsing remains protocol-owned. */
export function composerMentionMatch(
  body: string,
  caret: number,
): ComposerMentionMatch | undefined {
  return messageMentionQueryAt(body, caret);
}

export function filterComposerMentionAgents<Agent extends ComposerMentionAgent>(
  agents: readonly Agent[],
  match: ComposerMentionMatch,
): readonly Agent[] {
  return rankComposerSuggestions(agents, match.query, (agent) => [
    { raw: agent.handle, priority: 0 },
    { raw: agent.displayName, priority: 1 },
    { raw: agent.description ?? "", priority: 3 },
    { raw: agent.sourceServerLabel ?? "", priority: 4 },
  ]);
}

export function completeComposerMention(
  body: string,
  handle: string,
  match: ComposerMentionMatch,
): { caret: number; text: string } {
  const inserted = `@${handle.replace(/^@/u, "")} `;
  const before = body.slice(0, match.start);
  const after = body.slice(match.end).replace(/^ /u, "");
  return {
    caret: before.length + inserted.length,
    text: before + inserted + after,
  };
}

export type ComposerChannel = {
  roomId: string;
  name: string;
  kind: string;
  description?: string | undefined;
  archivedAt?: string | undefined;
};

/** Presentation-only query; channel authority remains the supplied Room directory. */
export function composerChannelMatch(
  body: string,
  caret: number,
): ComposerMentionMatch | undefined {
  if (caret < 0 || caret > body.length) return undefined;
  const visible = visibleMessageText(body);
  const start = visible.lastIndexOf("#", caret - 1);
  if (start < 0 || /[\p{L}\p{N}_./#-]/u.test(visible[start - 1] ?? ""))
    return undefined;
  const query = visible.slice(start + 1, caret);
  if (!/^[\p{L}\p{N}_.-]*$/u.test(query)) return undefined;
  return { start, end: caret, query };
}

export function filterComposerChannels<T extends ComposerChannel>(
  channels: readonly T[],
  match: ComposerMentionMatch,
): readonly T[] {
  return rankComposerSuggestions(
    channels.filter((channel) => channel.kind === "channel"),
    match.query,
    (channel) => [
      { raw: channel.name, priority: 0 },
      { raw: channel.description ?? "", priority: 3 },
    ],
  );
}

export function completeComposerChannel(
  body: string,
  name: string,
  match: ComposerMentionMatch,
): { text: string; caret: number } {
  const inserted = `#${name} `;
  return {
    text:
      body.slice(0, match.start) +
      inserted +
      body.slice(match.end).replace(/^ /u, ""),
    caret: match.start + inserted.length,
  };
}

/** Raft Jtt/t9: newest thread speakers first, retaining match rank for ties. */
export function prioritizeComposerParticipants<T extends ComposerMentionAgent>(
  ranked: readonly T[],
  recentParticipantIds: readonly string[],
): readonly T[] {
  const recent = new Map<string, number>();
  for (const id of recentParticipantIds)
    if (!recent.has(id)) recent.set(id, recent.size);
  return [...ranked].sort(
    (a, b) =>
      (recent.get(a.participantId) ?? Infinity) -
      (recent.get(b.participantId) ?? Infinity),
  );
}
