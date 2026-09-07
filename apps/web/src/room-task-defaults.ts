import type { RoomTaskDefaults } from "@rah-os/protocol";
import type { RoomAgentTarget, TaskParticipantSelection } from "@rah-os/ui-web";

/**
 * ADR-0020 rule 5: the server never injects Room Task defaults into Task
 * creation. The Web prefills them so the Human always sees — and can change —
 * the exact participants the submitted command will carry.
 */
export function seedTaskParticipantsFromRoomDefaults(input: {
  availableAgents: readonly RoomAgentTarget[];
  taskDefaults?: RoomTaskDefaults | undefined;
}): TaskParticipantSelection {
  const empty: TaskParticipantSelection = {
    collaboratorIds: [],
    reviewerIds: [],
  };
  const defaults = input.taskDefaults;
  if (defaults === undefined) return empty;
  const available = new Set(
    input.availableAgents.map(({ participantId }) => participantId),
  );
  const assigneeId = defaults.defaultAssigneeId;
  if (assigneeId === undefined || !available.has(assigneeId)) return empty;
  const select = (participantIds: readonly string[]) =>
    [
      ...new Set(
        participantIds.filter(
          (participantId) =>
            participantId !== assigneeId && available.has(participantId),
        ),
      ),
    ].sort();
  return {
    assigneeId,
    collaboratorIds: select(defaults.defaultCollaboratorIds),
    reviewerIds: select(defaults.defaultReviewerIds),
  };
}

/** Projects an edited selection onto the canonical `taskDefaults` payload. */
export function roomTaskDefaultsFromSelection(
  selection: TaskParticipantSelection,
): RoomTaskDefaults {
  const assigneeId = selection.assigneeId;
  if (assigneeId === undefined) {
    return { defaultCollaboratorIds: [], defaultReviewerIds: [] };
  }
  const select = (participantIds: readonly string[]) =>
    [
      ...new Set(
        participantIds.filter((participantId) => participantId !== assigneeId),
      ),
    ].sort();
  return {
    defaultAssigneeId: assigneeId,
    defaultCollaboratorIds: select(selection.collaboratorIds),
    defaultReviewerIds: select(selection.reviewerIds),
  };
}

/**
 * `RoomTaskDefaultsSchema` additionally requires the two lists to be disjoint,
 * which `taskParticipantsForSelection` does not enforce for a single Task.
 */
export function roomTaskDefaultsIssue(
  selection: TaskParticipantSelection,
): string | undefined {
  const reviewers = new Set(selection.reviewerIds);
  return selection.collaboratorIds.some((participantId) =>
    reviewers.has(participantId),
  )
    ? "默认协作者与默认审查者不能是同一个 Agent"
    : undefined;
}

export function taskParticipantSelectionsEqual(
  left: TaskParticipantSelection,
  right: TaskParticipantSelection,
): boolean {
  const sameList = (a: readonly string[], b: readonly string[]) => {
    if (a.length !== b.length) return false;
    const sorted = [...b].sort();
    return [...a].sort().every((id, index) => id === sorted[index]);
  };
  return (
    left.assigneeId === right.assigneeId &&
    sameList(left.collaboratorIds, right.collaboratorIds) &&
    sameList(left.reviewerIds, right.reviewerIds)
  );
}
