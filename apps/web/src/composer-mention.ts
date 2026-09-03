import {
  messageMentionQueryAt,
  type MessageMentionQuery,
} from "@rah-os/protocol";

export type ComposerMentionAgent = {
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
  const query = match.query.toLocaleLowerCase();
  return agents
    .filter((agent) => {
      if (query === "") return true;
      return [agent.handle, agent.displayName].some((value) =>
        value.toLocaleLowerCase().includes(query),
      );
    })
    .slice(0, 8);
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
