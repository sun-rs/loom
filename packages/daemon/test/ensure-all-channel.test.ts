import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import {
  AllChannelPrecheckError,
  ensureAllChannel,
  precheckAllChannel,
} from "../src/ensure-all-channel.ts";

type Fixture = {
  accessToken: string;
  actor: ReturnType<RoomKernel["authenticateAccessToken"]>;
  close(): void;
  controlRoomId: string;
  councilRoomId: string;
  databasePath: string;
  humanPrincipalId: string;
  kernel: RoomKernel;
  workspaceId: string;
};

function setup(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "rah-all-precheck-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "w",
    slug: "w",
    idempotencyKey: "w",
  });
  const council = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    name: "Agent Council",
    slug: "agent-council",
    kind: "channel",
    description: "council",
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "council",
  }).room;
  kernel.postMessage(actor, {
    roomId: council.roomId,
    body: "council history",
    idempotencyKey: "council-message",
    recipients: [],
    basedOnRoomSeq: kernel.sync(actor, {
      roomId: council.roomId,
      consumerId: "seed",
    }).latestRoomSeq,
  });
  return {
    accessToken: human.accessToken,
    actor,
    close() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    controlRoomId: workspace.controlRoom.roomId,
    councilRoomId: council.roomId,
    databasePath,
    humanPrincipalId: human.principal.principalId,
    kernel,
    workspaceId: workspace.workspace.workspaceId,
  };
}

/** Per-Room event digest: proves untouched Rooms keep byte-identical history. */
function historyDigest(
  databasePath: string,
  options: { exceptRoomIds?: string[] } = {},
): Map<string, string> {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const digests = new Map<string, string>();
    for (const row of database
      .prepare(
        `SELECT room_id, room_seq, type, actor_id, aggregate_type, aggregate_id,
                payload_json, idempotency_key, created_at
         FROM room_events ORDER BY room_id, room_seq`,
      )
      .all() as Record<string, unknown>[]) {
      const roomId = String(row.room_id);
      if (options.exceptRoomIds?.includes(roomId)) continue;
      const hash = createHash("sha256")
        .update(digests.get(roomId) ?? "")
        .update(JSON.stringify(row))
        .digest("hex");
      digests.set(roomId, hash);
    }
    return digests;
  } finally {
    database.close();
  }
}

function mutateRooms(
  databasePath: string,
  statement: string,
  ...bind: unknown[]
) {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(statement).run(...(bind as never[]));
  } finally {
    database.close();
  }
}

function allRoomRows(databasePath: string): Record<string, unknown>[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database
      .prepare(
        "SELECT room_id, slug, name, visibility, archived_at FROM rooms WHERE slug='all' OR name='all' ORDER BY room_id",
      )
      .all() as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

function precheckError(run: () => unknown): AllChannelPrecheckError {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof AllChannelPrecheckError,
      `expected a precheck error, got ${String(error)}`,
    );
    return error;
  }
  throw new assert.AssertionError({
    message: "expected a fail-closed precheck",
  });
}

test("canonical bootstrap is idempotent and the precheck reports no conflict", () => {
  const f = setup();
  try {
    const before = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(before.status, "missing");
    assert.equal(before.autoRecoverable, true);
    assert.deepEqual(before.candidates, []);
    const baseline = historyDigest(f.databasePath, {
      exceptRoomIds: [f.controlRoomId],
    });
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    );
    assert.ok(all);
    assert.equal(all.name, "all");
    assert.equal(all.visibility, "public");
    const second = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    );
    assert.equal(second?.roomId, all.roomId);
    const after = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(after.status, "canonical");
    assert.equal(after.canonical?.roomId, all.roomId);
    assert.equal(after.humanMembership, "present");
    assert.ok(after.canonical && after.canonical.memberCount >= 1);
    assert.equal(allRoomRows(f.databasePath).length, 1);
    assert.deepEqual(
      historyDigest(f.databasePath, {
        exceptRoomIds: [all.roomId, f.controlRoomId],
      }),
      baseline,
    );
  } finally {
    f.close();
  }
});

test("hidden system Channel short-circuits before any precheck write", () => {
  const f = setup();
  try {
    ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId);
    f.kernel.updateSystemChannelVisibility(f.actor, {
      workspaceId: f.workspaceId,
      hidden: true,
      basedOnRoomSeq: f.kernel.sync(f.actor, {
        roomId: f.controlRoomId,
        consumerId: "hide-test",
      }).latestRoomSeq,
      idempotencyKey: "hide",
    });
    assert.equal(
      precheckAllChannel(f.kernel, f.accessToken, f.workspaceId).status,
      "hidden",
    );
    assert.equal(
      ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId),
      undefined,
    );
    assert.equal(
      f.kernel.getSystemChannelVisibility(f.actor, {
        workspaceId: f.workspaceId,
      }).hidden,
      true,
    );
  } finally {
    f.close();
  }
});

test("archived legacy all fails closed with identity diagnostics and no write", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    mutateRooms(
      f.databasePath,
      "UPDATE rooms SET archived_at=? WHERE room_id=?",
      "2026-01-01T00:00:00.000Z",
      all.roomId,
    );
    const baseline = historyDigest(f.databasePath);
    const precheck = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(precheck.status, "archived");
    assert.equal(precheck.autoRecoverable, false);
    assert.equal(precheck.candidates[0]?.roomId, all.roomId);
    assert.equal(
      precheck.candidates[0]?.archivedAt,
      "2026-01-01T00:00:00.000Z",
    );
    assert.ok(precheck.recovery.length > 0);
    const error = precheckError(() =>
      ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId),
    );
    assert.match(error.message, /explicit recovery/i);
    assert.ok(error.message.includes(all.roomId));
    assert.ok(error.message.includes("archived"));
    assert.equal(error.precheck.status, "archived");
    assert.equal(allRoomRows(f.databasePath).length, 1);
    assert.deepEqual(historyDigest(f.databasePath), baseline);
  } finally {
    f.close();
  }
});

test("private legacy all is never publicized and never duplicated", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    // A pre-upgrade database can hold a private #all the Human cannot even list.
    mutateRooms(
      f.databasePath,
      "UPDATE rooms SET visibility='private' WHERE room_id=?",
      all.roomId,
    );
    mutateRooms(
      f.databasePath,
      "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
      all.roomId,
      f.humanPrincipalId,
    );
    const baseline = historyDigest(f.databasePath);
    assert.equal(
      f.kernel
        .listRooms(f.actor, { workspaceId: f.workspaceId })
        .find((room) => room.roomId === all.roomId),
      undefined,
      "membership-scoped listing cannot see the legacy Room",
    );
    const precheck = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(precheck.status, "private");
    assert.equal(precheck.humanMembership, "missing");
    const error = precheckError(() =>
      ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId),
    );
    assert.ok(error.message.includes("private"));
    const rows = allRoomRows(f.databasePath);
    assert.equal(rows.length, 1, "no duplicate canonical all is created");
    assert.equal(rows[0]?.visibility, "private", "privacy is never flipped");
    assert.deepEqual(historyDigest(f.databasePath), baseline);
  } finally {
    f.close();
  }
});

test("display-name drift on the canonical Room is restored without losing history", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    mutateRooms(
      f.databasePath,
      "UPDATE rooms SET name='General', description='legacy note' WHERE room_id=?",
      all.roomId,
    );
    const baseline = historyDigest(f.databasePath, {
      exceptRoomIds: [all.roomId],
    });
    const precheck = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(precheck.status, "name_drift");
    assert.equal(precheck.autoRecoverable, true);
    const recovered = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    );
    assert.equal(recovered?.roomId, all.roomId, "identity is preserved");
    assert.equal(recovered?.name, "all");
    assert.equal(recovered?.visibility, "public");
    assert.equal(
      recovered?.description,
      "legacy note",
      "history is not erased",
    );
    assert.equal(allRoomRows(f.databasePath).length, 1);
    assert.deepEqual(
      historyDigest(f.databasePath, { exceptRoomIds: [all.roomId] }),
      baseline,
    );
    // Retry after recovery is idempotent.
    assert.equal(
      precheckAllChannel(f.kernel, f.accessToken, f.workspaceId).status,
      "canonical",
    );
    const digest = historyDigest(f.databasePath);
    assert.equal(
      ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId)
        ?.roomId,
      all.roomId,
    );
    assert.deepEqual(historyDigest(f.databasePath), digest);
  } finally {
    f.close();
  }
});

test("several all candidates fail closed and list every conflicting identity", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    const impostor = f.kernel.createWorkspaceRoom(f.actor, {
      workspaceId: f.workspaceId,
      name: "Everyone",
      slug: "all-legacy",
      kind: "channel",
      visibility: "public",
      basedOnControlRoomSeq: f.kernel.sync(f.actor, {
        roomId: f.controlRoomId,
        consumerId: "impostor",
      }).latestRoomSeq,
      idempotencyKey: "impostor",
    }).room;
    mutateRooms(
      f.databasePath,
      "UPDATE rooms SET name='all' WHERE room_id=?",
      impostor.roomId,
    );
    const baseline = historyDigest(f.databasePath);
    const precheck = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(precheck.status, "ambiguous");
    assert.equal(precheck.autoRecoverable, false);
    assert.equal(precheck.candidates.length, 2);
    const error = precheckError(() =>
      ensureAllChannel(f.kernel, f.accessToken, f.workspaceId, f.controlRoomId),
    );
    for (const roomId of [all.roomId, impostor.roomId])
      assert.ok(error.message.includes(roomId));
    assert.equal(allRoomRows(f.databasePath).length, 2);
    assert.deepEqual(historyDigest(f.databasePath), baseline);
  } finally {
    f.close();
  }
});

test("an interrupted recovery leaves a consistent state the next start repairs", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    mutateRooms(
      f.databasePath,
      "UPDATE rooms SET name='General' WHERE room_id=?",
      all.roomId,
    );
    const baseline = historyDigest(f.databasePath);
    const failing = new Proxy(f.kernel, {
      get(target, property, receiver) {
        if (property === "updateWorkspaceRoom")
          return () => {
            throw new Error("simulated crash mid-recovery");
          };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as RoomKernel;
    assert.throws(
      () =>
        ensureAllChannel(
          failing,
          f.accessToken,
          f.workspaceId,
          f.controlRoomId,
        ),
      /simulated crash mid-recovery/,
    );
    assert.equal(allRoomRows(f.databasePath).length, 1);
    assert.deepEqual(
      historyDigest(f.databasePath),
      baseline,
      "a failed recovery writes nothing",
    );
    const recovered = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    );
    assert.equal(recovered?.roomId, all.roomId);
    assert.equal(recovered?.name, "all");
  } finally {
    f.close();
  }
});

test("a missing Human membership is reported instead of silently repaired", () => {
  const f = setup();
  try {
    const all = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
    )!;
    mutateRooms(
      f.databasePath,
      "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
      all.roomId,
      f.humanPrincipalId,
    );
    const precheck = precheckAllChannel(f.kernel, f.accessToken, f.workspaceId);
    assert.equal(precheck.status, "canonical");
    assert.equal(precheck.humanMembership, "missing");
    assert.ok(
      precheck.recovery.some((step) => /membership/i.test(step)),
      "the report names the operator decision",
    );
    const reported: unknown[] = [];
    const room = ensureAllChannel(
      f.kernel,
      f.accessToken,
      f.workspaceId,
      f.controlRoomId,
      { onPrecheck: (result) => reported.push(result) },
    );
    assert.equal(room?.roomId, all.roomId, "no duplicate canonical all");
    assert.equal(
      (reported[0] as { humanMembership: string }).humanMembership,
      "missing",
    );
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      assert.equal(
        database
          .prepare(
            "SELECT COUNT(*) AS n FROM memberships WHERE room_id=? AND principal_id=?",
          )
          .get(all.roomId, f.humanPrincipalId)?.n,
        0,
        "membership is not fabricated outside the canonical contract",
      );
    } finally {
      database.close();
    }
  } finally {
    f.close();
  }
});
