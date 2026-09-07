import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHumanApplicationPort, RoomKernel } from "../src/index.ts";

test("Workspace Human directory is the canonical control-Room identity projection", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-workspace-humans-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const colleague = kernel.provisionPrincipal({
      handle: "colleague",
      kind: "human",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
    const ownerActor = kernel.authenticateHumanAccessToken(owner.accessToken);
    const colleagueActor = kernel.authenticateHumanAccessToken(
      colleague.accessToken,
    );
    const outsiderActor = kernel.authenticateHumanAccessToken(
      outsider.accessToken,
    );
    const workspace = kernel.createWorkspace(ownerActor, {
      idempotencyKey: "workspace",
      name: "People",
      slug: "people",
    });
    kernel.addRoomMember(ownerActor, {
      basedOnRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "add-colleague",
      principalId: colleague.principal.principalId,
      role: "member",
      roomId: workspace.controlRoom.roomId,
    });
    kernel.addMember(ownerActor, {
      principalId: agent.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const port = createHumanApplicationPort(kernel) as unknown as {
      listWorkspaceHumans: (
        actor: typeof ownerActor,
        request: { workspaceId: string },
      ) => {
        humans: Array<{
          membership: { joinedAt: string; role: string };
          principal: { handle: string; kind: string; principalId: string };
        }>;
        truncated: boolean;
        workspaceId: string;
      };
    };
    const result = port.listWorkspaceHumans(ownerActor, {
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.equal(result.workspaceId, workspace.workspace.workspaceId);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.humans.map(({ principal }) => principal.handle),
      ["colleague", "owner"],
    );
    assert.equal(
      result.humans.every(({ principal }) => principal.kind === "human"),
      true,
    );
    assert.equal(
      result.humans.find(
        ({ principal }) =>
          principal.principalId === owner.principal.principalId,
      )?.membership.role,
      "owner",
    );
    assert.deepEqual(
      port
        .listWorkspaceHumans(colleagueActor, {
          workspaceId: workspace.workspace.workspaceId,
        })
        .humans.map(({ principal }) => principal.handle),
      ["colleague", "owner"],
    );
    assert.throws(
      () =>
        port.listWorkspaceHumans(outsiderActor, {
          workspaceId: workspace.workspace.workspaceId,
        }),
      /member|unavailable|access/i,
    );
  } finally {
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
