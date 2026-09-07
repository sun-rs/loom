import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RoomTaskDefaultsSchema } from "@rah-os/protocol";
import type { RoomAgentTarget } from "@rah-os/ui-web";

import {
  roomTaskDefaultsFromSelection,
  roomTaskDefaultsIssue,
  seedTaskParticipantsFromRoomDefaults,
  taskParticipantSelectionsEqual,
} from "../src/room-task-defaults.ts";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const agents: readonly RoomAgentTarget[] = [
  { handle: "alpha", participantId: "agent-a" },
  { handle: "beta", participantId: "agent-b" },
  { handle: "gamma", participantId: "agent-c" },
];

test("Room Task defaults seed only participants that remain available Room Agents", () => {
  assert.deepEqual(
    seedTaskParticipantsFromRoomDefaults({ availableAgents: agents }),
    { collaboratorIds: [], reviewerIds: [] },
    "an absent taskDefaults keeps the historical empty prefill",
  );
  assert.deepEqual(
    seedTaskParticipantsFromRoomDefaults({
      availableAgents: agents,
      taskDefaults: {
        defaultAssigneeId: "agent-a",
        defaultCollaboratorIds: ["agent-c", "agent-b"],
        defaultReviewerIds: ["agent-c"],
      },
    }),
    {
      assigneeId: "agent-a",
      collaboratorIds: ["agent-b", "agent-c"],
      reviewerIds: ["agent-c"],
    },
  );
  assert.deepEqual(
    seedTaskParticipantsFromRoomDefaults({
      availableAgents: agents,
      taskDefaults: {
        defaultAssigneeId: "agent-a",
        defaultCollaboratorIds: ["agent-b", "agent-removed"],
        defaultReviewerIds: ["agent-removed"],
      },
    }),
    { assigneeId: "agent-a", collaboratorIds: ["agent-b"], reviewerIds: [] },
    "ids that are no longer Room Agents are dropped instead of failing submit",
  );
  assert.deepEqual(
    seedTaskParticipantsFromRoomDefaults({
      availableAgents: agents,
      taskDefaults: {
        defaultAssigneeId: "agent-removed",
        defaultCollaboratorIds: ["agent-b"],
        defaultReviewerIds: ["agent-c"],
      },
    }),
    { collaboratorIds: [], reviewerIds: [] },
    "secondary roles never survive a missing default assignee",
  );
  assert.deepEqual(
    seedTaskParticipantsFromRoomDefaults({
      availableAgents: [],
      taskDefaults: {
        defaultAssigneeId: "agent-a",
        defaultCollaboratorIds: [],
        defaultReviewerIds: [],
      },
    }),
    { collaboratorIds: [], reviewerIds: [] },
  );
});

test("Room Task defaults round-trip into a canonical update payload", () => {
  const cleared = roomTaskDefaultsFromSelection({
    collaboratorIds: [],
    reviewerIds: [],
  });
  assert.deepEqual(cleared, {
    defaultCollaboratorIds: [],
    defaultReviewerIds: [],
  });
  assert.ok(RoomTaskDefaultsSchema.safeParse(cleared).success);
  const configured = roomTaskDefaultsFromSelection({
    assigneeId: "agent-a",
    collaboratorIds: ["agent-c", "agent-b"],
    reviewerIds: [],
  });
  assert.deepEqual(configured, {
    defaultAssigneeId: "agent-a",
    defaultCollaboratorIds: ["agent-b", "agent-c"],
    defaultReviewerIds: [],
  });
  assert.ok(RoomTaskDefaultsSchema.safeParse(configured).success);
  assert.equal(
    seedTaskParticipantsFromRoomDefaults({
      availableAgents: agents,
      taskDefaults: configured,
    }).assigneeId,
    "agent-a",
  );
});

test("Room Task defaults reject a role overlap the single-Task rules allow", () => {
  assert.equal(
    roomTaskDefaultsIssue({
      assigneeId: "agent-a",
      collaboratorIds: ["agent-b"],
      reviewerIds: ["agent-c"],
    }),
    undefined,
  );
  const overlap = {
    assigneeId: "agent-a",
    collaboratorIds: ["agent-b"],
    reviewerIds: ["agent-b"],
  };
  assert.ok(roomTaskDefaultsIssue(overlap));
  assert.ok(
    !RoomTaskDefaultsSchema.safeParse(roomTaskDefaultsFromSelection(overlap))
      .success,
    "the canonical schema would have rejected the same payload",
  );
});

test("Room Task default edits are dirty only when the stored selection changes", () => {
  const stored = {
    assigneeId: "agent-a",
    collaboratorIds: ["agent-b"],
    reviewerIds: ["agent-c"],
  };
  assert.ok(taskParticipantSelectionsEqual(stored, { ...stored }));
  assert.ok(
    !taskParticipantSelectionsEqual(stored, {
      ...stored,
      collaboratorIds: ["agent-b", "agent-c"],
    }),
  );
  assert.ok(
    !taskParticipantSelectionsEqual(stored, {
      collaboratorIds: [],
      reviewerIds: [],
    }),
  );
  assert.ok(
    taskParticipantSelectionsEqual(
      { collaboratorIds: [], reviewerIds: [] },
      { collaboratorIds: [], reviewerIds: [] },
    ),
  );
});

test("Room settings edits the Task default participants and sends them only when dirty", () => {
  const source = read("components/room-dialogs.tsx");
  assert.match(source, /任务默认参与者/u, "the settings block is labelled");
  assert.match(
    source,
    /seedTaskParticipantsFromRoomDefaults/u,
    "stored defaults are shown on open",
  );
  assert.match(source, /<TaskParticipantFields/u, "the Task role UI is reused");
  assert.match(
    source,
    /taskDefaultsDirty[\s\S]{0,400}roomTaskDefaultsFromSelection/u,
    "taskDefaults joins the update request only when the block is dirty",
  );
  assert.match(
    source,
    /setTaskDefaultCollaboratorIds\(\[\]\);\s*\n\s*setTaskDefaultReviewerIds\(\[\]\);/u,
    "clearing the default assignee clears the secondary roles",
  );
});

test("the Task create dialog reveals the Room default participants it prefilled", () => {
  const source = read("components/task-dialogs.tsx");
  assert.match(
    source,
    /seedTaskParticipantsFromRoomDefaults/u,
    "initial participants seed from the Room defaults",
  );
  assert.match(
    source,
    /const \[configurationOpen, setConfigurationOpen\] = useState\(false\);/u,
    "the configuration page never steals the opening view from the title inputs",
  );
  assert.match(
    source,
    /const participantSummary =\s*\n\s*assigneeId === undefined/u,
    "the summary row is derived from the live seeded selection",
  );
  assert.match(
    source,
    /负责人 @\$\{handleOf\(assigneeId\)\}/u,
    "roles are named with the same Agent handles TaskParticipantFields shows",
  );
  assert.match(
    source,
    /rah-task-create-fields[\s\S]{0,200}默认参与者：\{participantSummary\}/u,
    "the summary row renders above the title rows on the main view",
  );
  assert.match(
    source,
    /默认参与者：[\s\S]{0,400}配置协作与依赖/u,
    "the configuration affordance sits next to the summary row",
  );
});

test("the composer seeds Room Task defaults when the Human switches to a Task", () => {
  const source = read("components/conversation-panes.tsx");
  assert.match(
    source,
    /roomTaskDefaults/u,
    "the Room defaults reach the composer",
  );
  assert.match(
    source,
    /setAsTask\(true\)/u,
    "toggling 作为任务 runs the seeding path",
  );
  assert.match(
    source,
    /seedTaskParticipantsFromRoomDefaults/u,
    "the composer prefills the same seeded participants",
  );
  const app = read("App.tsx");
  assert.match(
    app,
    /roomTaskDefaults=\{activeRoom\?\.taskDefaults\}/u,
    "App passes the canonical Room defaults down",
  );
});
