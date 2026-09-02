import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

test("Human profile updates are authenticated, durable, and self-scoped", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-principal-profile-"));
  const databasePath = join(directory, "room.db");
  let kernel: RoomKernel | undefined = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "alice", kind: "agent" });
    let actor = kernel.authenticateHumanAccessToken(human.accessToken);

    const updated = kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: "avatar-03",
      displayName: "Hakase",
    });
    assert.deepEqual(updated, {
      avatarKey: "avatar-03",
      displayName: "Hakase",
      handle: "owner",
      kind: "human",
      principalId: human.principal.principalId,
    });
    assert.throws(
      () =>
        kernel!.updateAuthenticatedPrincipal(
          kernel!.authenticateAccessToken(agent.accessToken),
          { avatarKey: null, displayName: "Agent" },
        ),
      /human/i,
    );

    kernel.close();
    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    actor = kernel.authenticateHumanAccessToken(human.accessToken);
    assert.equal(kernel.getAuthenticatedPrincipal(actor).displayName, "Hakase");
    assert.equal(
      kernel.getAuthenticatedPrincipal(actor).avatarKey,
      "avatar-03",
    );
  } finally {
    kernel?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("schema 28 Principal rows gain nullable profile columns without identity loss", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-principal-profile-v28-"));
  const databasePath = join(directory, "room.db");
  let kernel: RoomKernel | undefined = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    kernel.close();
    kernel = undefined;

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "ALTER TABLE principals DROP COLUMN display_name; ALTER TABLE principals DROP COLUMN avatar_key; PRAGMA user_version = 28",
    );
    legacy.close();

    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    assert.deepEqual(kernel.getAuthenticatedPrincipal(actor), human.principal);
  } finally {
    kernel?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
