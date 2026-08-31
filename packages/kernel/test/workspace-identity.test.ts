import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "../src/index.ts";

test("Workspace identity is manager-owned, causal, idempotent and durable", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-workspace-identity-"));
  let kernel = new RoomKernel({ databasePath: join(dir, "room.db") });
  try {
    kernel.initialize();
    const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const outsider = kernel.provisionPrincipal({
      handle: "other",
      kind: "human",
    });
    let actor = kernel.authenticateAccessToken(owner.accessToken);
    const created = kernel.createWorkspace(actor, {
      name: "Mac",
      slug: "mac",
      idempotencyKey: "create",
    });
    const input = {
      workspaceId: created.workspace.workspaceId,
      name: "Design Lab",
      avatarKey: "robot",
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "identity",
    };
    assert.throws(
      () =>
        kernel.updateWorkspace(
          kernel.authenticateAccessToken(outsider.accessToken),
          input,
        ),
      /member|owner|admin/i,
    );
    const result = kernel.updateWorkspace(actor, input);
    assert.equal(result.workspace.name, "Design Lab");
    assert.equal(result.workspace.avatarKey, "robot");
    assert.equal(kernel.updateWorkspace(actor, input).deduplicated, true);
    assert.throws(
      () =>
        kernel.updateWorkspace(actor, { ...input, idempotencyKey: "stale" }),
      /stale/i,
    );
    assert.throws(
      () => kernel.updateWorkspace(actor, { ...input, name: "Another" }),
      /idempotency/i,
    );
    kernel.close();
    kernel = new RoomKernel({ databasePath: join(dir, "room.db") });
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    assert.equal(
      kernel
        .listWorkspaces(actor)
        .find((w) => w.workspaceId === input.workspaceId)?.avatarKey,
      "robot",
    );
    const cleared = kernel.updateWorkspace(actor, {
      ...input,
      avatarKey: null,
      basedOnControlRoomSeq: result.event.roomSeq,
      idempotencyKey: "clear",
    });
    assert.equal(cleared.workspace.avatarKey, undefined);
  } finally {
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("version 20 Workspaces migrate without replacing identity or history", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-workspace-v20-"));
  const path = join(dir, "room.db");
  let kernel = new RoomKernel({ databasePath: path });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    let actor = kernel.authenticateAccessToken(human.accessToken);
    const created = kernel.createWorkspace(actor, {
      name: "Original",
      slug: "original",
      idempotencyKey: "create",
    });
    kernel.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "ALTER TABLE workspaces DROP COLUMN avatar_key; PRAGMA user_version = 20",
    );
    legacy.close();
    kernel = new RoomKernel({ databasePath: path });
    kernel.initialize();
    actor = kernel.authenticateAccessToken(human.accessToken);
    assert.equal(kernel.listWorkspaces(actor)[0]?.name, "Original");
    const result = kernel.updateWorkspace(actor, {
      workspaceId: created.workspace.workspaceId,
      name: "Original",
      avatarKey: "cat",
      basedOnControlRoomSeq: created.event.roomSeq,
      idempotencyKey: "avatar",
    });
    assert.equal(result.workspace.workspaceId, created.workspace.workspaceId);
    assert.equal(result.event.roomSeq, created.event.roomSeq + 1);
  } finally {
    kernel.close();
    rmSync(dir, { force: true, recursive: true });
  }
});
