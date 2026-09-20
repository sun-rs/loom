import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Room } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import {
  directConversationEntries,
  directConversationPeer,
} from "../src/direct-conversation-entries.ts";

const alice: WorkspaceAgentView = {
  agentId: "def-a",
  createdAt: "2026-08-30T00:00:00.000Z",
  createdBy: "human",
  displayName: "Renamed Alice",
  executionPolicyRevisionId: "policy-a",
  handle: "alice",
  participantId: "agent-a",
  role: "Developer",
  runtimeAvailable: true,
  runtimeLabels: [],
  skillRefs: [],
  state: "enabled",
};
const direct: Room = {
  createdAt: alice.createdAt,
  kind: "direct",
  name: "Old name",
  roomId: "dm-a",
  slug: "dm-a",
  workspaceId: "workspace",
  directParticipantIds: ["human", "agent-a"],
};

test("DM entry exists before a Room; durable pair identity survives rename and same names", () => {
  assert.equal(
    directConversationEntries([alice], [], "human")[0]?.peerPrincipalId,
    "agent-a",
  );
  const rows = directConversationEntries(
    [alice, { ...alice, agentId: "def-b", participantId: "agent-b" }],
    [direct],
    "human",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.roomId, "dm-a");
  assert.equal(rows[0]?.label, "Renamed Alice");
  assert.equal(rows[1]?.roomId, undefined);
});

test("existing Human DM stays reachable; archived/tombstoned entries cannot masquerade as active Agents", () => {
  const humanRoom: Room = {
    ...direct,
    roomId: "dm-human",
    name: "Bob",
    directParticipantIds: ["human", "bob"],
  };
  const rows = directConversationEntries(
    [{ ...alice, state: "tombstoned" }],
    [humanRoom],
    "human",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.roomId, "dm-human");
  assert.equal(rows[0]?.peerPrincipalId, "bob");
});

test("deleted Agent DM keeps its identity beside a new same-name Agent and survives reload", () => {
  const deleted = { ...alice, state: "tombstoned" as const };
  const replacement = {
    ...alice,
    agentId: "def-new",
    participantId: "agent-new",
  };
  const newRoom = {
    ...direct,
    roomId: "dm-new",
    directParticipantIds: ["human", "agent-new"] as [string, string],
  };
  for (const rooms of [[direct], [direct, newRoom]]) {
    const rows = directConversationEntries(
      [deleted, replacement],
      rooms,
      "human",
    );
    assert.equal(rows.length, 2);
    const old = rows.find((row) => row.roomId === "dm-a");
    assert.equal(old?.label, alice.displayName);
    assert.equal(old?.agent?.agentId, "def-a");
    assert.equal(old?.agent?.state, "tombstoned");
    assert.equal(
      rows.find((row) => row.peerPrincipalId === "agent-new")?.roomId,
      rooms.length === 2 ? "dm-new" : undefined,
    );
    assert.equal(
      directConversationPeer([deleted, replacement], direct, "human")?.agentId,
      "def-a",
    );
    assert.deepEqual(
      directConversationEntries(
        JSON.parse(JSON.stringify([deleted, replacement])),
        JSON.parse(JSON.stringify(rooms)),
        "human",
      ),
      rows,
    );
  }
});

test("Agent profile queries are keyed by identity/revision rather than transient view objects", () => {
  const source = readFileSync(
    new URL("../src/components/agent-directory-pane.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\[client, selectedAgent\]/u);
  assert.doesNotMatch(source, /\[client, selectedAgent, tab\]/u);
  assert.match(source, /编辑运行时配置/u);
  assert.match(source, /detailRevisionId/u);
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /const agentDirectoryQuery = useReconciledQuery\(\s*client,\s*"agent.list",\s*\{\s*controlRoomId: activeWorkspace\?\.controlRoomId \?\? "none",\s*includeDeleted: true,\s*\},[\s\S]*?\sreload,\s*\);/u,
  );
});

test("all authored Agent danger colors resolve through the imported coral token", () => {
  const css = readFileSync(
    new URL("../src/agent-directory.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /var\(--red\)/u);
});
