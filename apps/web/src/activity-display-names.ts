import {
  messageMentionCandidates,
  messageReferenceNameKey,
  type Principal,
} from "@rah-os/protocol";

type Person = Pick<
  Principal,
  "principalId" | "kind" | "handle" | "displayName"
>;

/** Plain activity excerpts retain their authored formatting and navigation owner. */
export function activityDisplayText(
  source: string,
  people: readonly Person[],
): string {
  const humans = people.filter((person) => person.kind === "human");
  let cursor = 0;
  let result = "";
  for (const mention of messageMentionCandidates(
    source,
    humans.map((person) => person.handle),
  )) {
    const matches = humans.filter(
      (person) =>
        messageReferenceNameKey(person.handle) ===
        messageReferenceNameKey(mention.handle),
    );
    const person = matches.length === 1 ? matches[0] : undefined;
    result +=
      source.slice(cursor, mention.start) +
      (person ? `@${person.displayName || person.handle}` : mention.value);
    cursor = mention.end;
  }
  return result + source.slice(cursor);
}
