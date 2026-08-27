import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const sourceDirectory = join(import.meta.dirname, "..", "src");

test("WorkspaceScreen composes owner components without owning their DOM", () => {
  const app = readFileSync(join(sourceDirectory, "App.tsx"), "utf8");
  const dialogs = readFileSync(
    join(sourceDirectory, "components", "room-dialogs.tsx"),
    "utf8",
  );
  const agentDialogs = readFileSync(
    join(sourceDirectory, "components", "agent-dialogs.tsx"),
    "utf8",
  );
  const catalog = readFileSync(
    join(sourceDirectory, "components", "workspace-catalog-panes.tsx"),
    "utf8",
  );
  const navigation = readFileSync(
    join(sourceDirectory, "components", "workspace-navigation.tsx"),
    "utf8",
  );
  const conversation = readFileSync(
    join(sourceDirectory, "components", "conversation-panes.tsx"),
    "utf8",
  );

  assert.doesNotMatch(app, /function RoomCreateDialog/u);
  assert.doesNotMatch(app, /function RoomMembersDialog/u);
  assert.doesNotMatch(app, /function AgentCreateDialog/u);
  assert.doesNotMatch(app, /function AgentDirectoryPane/u);
  assert.doesNotMatch(app, /function ComputerRuntimePane/u);
  assert.doesNotMatch(app, /function RoomSidebar/u);
  assert.doesNotMatch(app, /function ChatPane/u);
  assert.doesNotMatch(app, /function TaskPane/u);
  assert.match(app, /from "\.\/components\/room-dialogs\.tsx"/u);
  assert.match(app, /from "\.\/components\/agent-dialogs\.tsx"/u);
  assert.match(app, /client\.request\("agent\.provision"/u);
  assert.match(app, /from "\.\/components\/workspace-catalog-panes\.tsx"/u);
  assert.match(app, /from "\.\/components\/workspace-navigation\.tsx"/u);
  assert.match(app, /from "\.\/components\/conversation-panes\.tsx"/u);

  assert.match(dialogs, /className="rah-dialog"/u);
  assert.match(dialogs, /className="rah-dialog rah-members-dialog"/u);
  assert.match(dialogs, /useDialogProtocol/u);
  assert.match(dialogs, /mutationPendingRef\.current/u);
  assert.match(dialogs, /disabled=\{!canManage \|\| blocked\}/u);
  assert.match(agentDialogs, /useDialogProtocol/u);
  assert.match(agentDialogs, /runtimeOfferId/u);
  assert.match(agentDialogs, /instructions/u);
  assert.match(catalog, /className="rah-runtime-grid rah-scroll-main"/u);
  assert.match(navigation, /className="rah-mobile-nav"/u);
  assert.match(conversation, /className="composer"/u);
  assert.match(conversation, /className="kanban"/u);
});
