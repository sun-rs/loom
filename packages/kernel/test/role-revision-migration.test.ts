import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

test("schema 59 Role becomes an immutable revision without altering its configuration or receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-role-revision-"));
  const databasePath = join(directory, "room.db");
  const first = new RoomKernel({ databasePath });
  let firstClosed = false;
  let reopened: RoomKernel | undefined;
  try {
    first.initialize();
    const owner = first.provisionPrincipal({ handle: "owner", kind: "human" });
    const auth = first.authenticateAccessToken(owner.accessToken);
    const workspace = first.createWorkspace(auth, {
      name: "Role migration",
      slug: "roles",
      idempotencyKey: "workspace",
    });
    const db = new DatabaseSync(databasePath);
    const roomId = workspace.controlRoom.roomId;
    const input = {
      controlRoomId: roomId,
      basedOnRoomSeq: Number(
        db
          .prepare("SELECT next_seq-1 seq FROM rooms WHERE room_id=?")
          .get(roomId)!.seq,
      ),
      idempotencyKey: "role",
      configuration: {
        displayName: "Reviewer",
        handle: "reviewer",
        instructions: "Preserve details.",
        role: "review",
        runtimeOfferId: "offer",
        modelIntent: { fallback: "disabled" as const },
      },
    };
    const original = first.roles.create(auth, input);
    first.close();
    firstClosed = true;
    db.exec("DROP TABLE role_revisions; PRAGMA user_version=59");
    db.close();
    reopened = new RoomKernel({ databasePath });
    reopened.initialize();
    const replay = reopened.roles.create(
      reopened.authenticateAccessToken(owner.accessToken),
      input,
    );
    assert.deepEqual(replay.role, original.role);
    assert.deepEqual(replay.event, original.event);
    assert.equal(replay.deduplicated, true);
    const migrated = new DatabaseSync(databasePath);
    assert.equal(
      migrated.prepare("SELECT count(*) n FROM role_revisions").get()!.n,
      1,
    );
    migrated.close();
  } finally {
    reopened?.close();
    if (!firstClosed) first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
