import type {
  PersonIdentity,
  WorkspaceEntities,
} from "../workspace-entities.ts";
import { taskPeopleChoices } from "../raft-discovery-controls.ts";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import type { DiscoveryOption } from "./discovery-filter.tsx";

/** Official n7/BJe row semantics; identity comes from the scoped entity directory.
 * Sentinels reserve the same leading slot but are never rendered as a person. */
export function taskPersonOptions(
  people: readonly PersonIdentity[],
  selfId: string | undefined,
  filter: "creator" | "assignee",
  entities: WorkspaceEntities | undefined,
): DiscoveryOption[] {
  return taskPeopleChoices(
    people.map((person) => entities?.resolvePerson(person) ?? person),
    selfId,
    filter,
  ).map((person) => ({
    id: person.id,
    label: person.label,
    searchText: person.searchText,
    italic: person.sentinel,
    reserveLeadingSlot: true,
    leading: person.sentinel ? undefined : (
      <ProfileImageAvatar
        avatarKey={person.avatarKey}
        name={person.label}
        kind={person.kind}
        principalId={person.id}
        size="compact"
      />
    ),
  }));
}
