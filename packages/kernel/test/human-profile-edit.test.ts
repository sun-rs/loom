import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

test("Human description shares the Principal owner, survives restart, and fences stale editors", () => {
  const root = mkdtempSync(join(tmpdir(), "rah-human-family-"));
  const databasePath = join(root, "room.db");
  let kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    const empty = { displayName: null, avatarKey: null, description: null };
    const saved = kernel.updateAuthenticatedPrincipal(actor, {
      displayName: "Owner",
      avatarKey: null,
      description: "  Local owner\nSecond line  ",
      expectedProfile: empty,
    });
    assert.equal(saved.description, "Local owner\nSecond line");
    assert.throws(
      () =>
        kernel.updateAuthenticatedPrincipal(actor, {
          displayName: "Stale name",
          avatarKey: null,
          description: "lost update",
          expectedProfile: empty,
        }),
      /changed|修改|stale/i,
    );
    assert.equal(kernel.getAuthenticatedPrincipal(actor).displayName, "Owner");
    // Old clients omit description: unrelated name/avatar saves must preserve it.
    kernel.updateAuthenticatedPrincipal(actor, {
      displayName: "Renamed",
      avatarKey: null,
    });
    assert.equal(
      kernel.getAuthenticatedPrincipal(actor).description,
      saved.description,
    );
    kernel.close();
    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const resumed = kernel.authenticateHumanAccessToken(human.accessToken);
    assert.equal(
      kernel.getAuthenticatedPrincipal(resumed).description,
      saved.description,
    );
    const expectedProfile = {
      displayName: "Renamed",
      avatarKey: null,
      description: saved.description!,
    };
    const clear = {
      displayName: "Renamed",
      avatarKey: null,
      description: "",
      expectedProfile,
    };
    assert.equal(
      kernel.updateAuthenticatedPrincipal(resumed, clear).description,
      undefined,
    );
    assert.equal(
      kernel.updateAuthenticatedPrincipal(resumed, clear).description,
      undefined,
      "exact replay succeeds without restoring old fields",
    );
    assert.throws(() =>
      kernel.updateAuthenticatedPrincipal(resumed, {
        ...clear,
        description: "x".repeat(3001),
      }),
    );
    const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
    assert.throws(
      () =>
        kernel.updateAuthenticatedPrincipal(
          kernel.authenticateAccessToken(agent.accessToken),
          { displayName: "agent", avatarKey: null, description: "forged" },
        ),
      /human/i,
    );
    assert.throws(() =>
      kernel.updateAuthenticatedPrincipal(resumed, {
        ...clear,
        principalId: agent.principal.principalId,
      } as never),
    );
  } finally {
    kernel.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("schema 46 adds Human description without losing existing identity or avatar", () => {
  const root = mkdtempSync(join(tmpdir(), "rah-human-migration-"));
  const databasePath = join(root, "room.db");
  let kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    kernel.updateAuthenticatedPrincipal(actor, {
      displayName: "Preserved",
      avatarKey: "avatar-03",
    });
    kernel.close();
    const db = new DatabaseSync(databasePath);
    db.exec(
      "ALTER TABLE principals DROP COLUMN description; PRAGMA user_version=46",
    );
    db.close();
    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const current = kernel.getAuthenticatedPrincipal(
      kernel.authenticateHumanAccessToken(human.accessToken),
    );
    assert.equal(current.displayName, "Preserved");
    assert.equal(current.avatarKey, "avatar-03");
    assert.equal(current.description, undefined);
  } finally {
    kernel.close();
    rmSync(root, { recursive: true, force: true });
  }
});
