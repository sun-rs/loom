import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";
import { ROOM_DELETION_REFERENCED_TABLES } from "../src/room-deletion-service.ts";

async function* bytes(value: string) {
  yield Buffer.from(value);
}

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-room-delete-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const member = kernel.provisionPrincipal({ handle: "member", kind: "human" });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const memberActor = kernel.authenticateAccessToken(member.accessToken);
  const workspace = kernel.createWorkspace(ownerActor, {
    idempotencyKey: "workspace-create",
    name: "Delete fixture",
    slug: "delete-fixture",
  });
  kernel.addMember(ownerActor, {
    principalId: member.principal.principalId,
    roomId: workspace.controlRoom.roomId,
  });
  const channel = kernel.createWorkspaceRoom(ownerActor, {
    basedOnControlRoomSeq: kernel.sync(ownerActor, {
      consumerId: "create-channel",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq,
    idempotencyKey: "channel-create",
    kind: "channel",
    name: "Delete me",
    slug: "delete-me",
    visibility: "public",
    workspaceId: workspace.workspace.workspaceId,
  });
  const head = () =>
    kernel.sync(ownerActor, {
      consumerId: "delete-head",
      roomId: channel.room.roomId,
    }).latestRoomSeq;
  return {
    channel,
    databasePath,
    directory,
    head,
    kernel,
    memberActor,
    owner,
    ownerActor,
    workspace,
    close() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

test("permanent Room deletion is strict, manager-only, kind-safe, stale-safe, and blocks active work", () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.memberActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "member-delete",
          roomId: f.channel.room.roomId,
        }),
      /owner or admin/i,
    );
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "control-delete",
          roomId: f.workspace.controlRoom.roomId,
        }),
      /regular Channels/i,
    );
    const stale = f.head();
    f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: stale,
      body: "advance the Room",
      idempotencyKey: "advance-room",
      roomId: f.channel.room.roomId,
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: stale,
          idempotencyKey: "stale-delete",
          roomId: f.channel.room.roomId,
        }),
      /stale/i,
    );
    f.kernel.createTask(f.ownerActor, {
      idempotencyKey: "active-task",
      roomId: f.channel.room.roomId,
      title: "Still active",
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "active-delete",
          roomId: f.channel.room.roomId,
        }),
      /active collaboration work/i,
    );
  } finally {
    f.close();
  }
});

test("permanent Room deletion erases canonical and personal projections and replays one durable receipt", async () => {
  const f = fixture();
  try {
    const message = f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      body: "Room content that must disappear",
      idempotencyKey: "message",
      roomId: f.channel.room.roomId,
    });
    f.kernel.messageSocial.react(f.ownerActor, {
      active: true,
      basedOnRoomSeq: f.head(),
      emoji: "👍",
      idempotencyKey: "reaction",
      messageId: message.event.aggregateId,
      roomId: f.channel.room.roomId,
    });
    f.kernel.messageSocial.save(f.ownerActor, {
      idempotencyKey: "save",
      messageId: message.event.aggregateId,
      roomId: f.channel.room.roomId,
      saved: true,
    });
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "evidence.txt",
      idempotencyKey: "file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    f.kernel.postRoomMessage(f.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      body: "",
      idempotencyKey: "file-message",
      roomId: f.channel.room.roomId,
    });
    const blob = join(f.directory, "room-files", upload.attachmentId);
    assert.equal(existsSync(blob), true);
    assert.equal(
      f.kernel.searchWorkspace(f.ownerActor, {
        query: "Room content",
        workspaceId: f.workspace.workspace.workspaceId,
      }).total,
      1,
    );

    const input = {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "delete-room",
      roomId: f.channel.room.roomId,
    };
    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, input);
    assert.equal(deleted.deduplicated, false);
    assert.deepEqual(deleted.fileGc, {
      failed: 0,
      pending: 0,
      reclaimed: 1,
      total: 1,
    });
    assert.equal(existsSync(blob), false);
    assert.equal(
      f.kernel
        .listRooms(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .some(({ roomId }) => roomId === f.channel.room.roomId),
      false,
    );
    assert.equal(
      f.kernel.messageSocial.saved(f.ownerActor, {
        workspaceId: f.workspace.workspace.workspaceId,
      }).items.length,
      0,
    );
    assert.equal(
      f.kernel.searchWorkspace(f.ownerActor, {
        query: "Room content",
        workspaceId: f.workspace.workspace.workspaceId,
      }).total,
      0,
    );
    assert.equal(
      f.kernel
        .listHumanActivity(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .items.some(({ roomId }) => roomId === f.channel.room.roomId),
      false,
    );
    assert.throws(
      () =>
        f.kernel.getMessageContext(f.ownerActor, {
          messageId: message.event.aggregateId,
          roomId: f.channel.room.roomId,
        }),
      /unavailable|not found|member/i,
    );
    assert.throws(
      () =>
        f.kernel.humanNavigation.resolve(f.ownerActor, {
          target: { kind: "room", roomId: f.channel.room.roomId },
        }),
      /unavailable|not found|forbidden/i,
    );
    assert.deepEqual(f.kernel.deleteWorkspaceRoom(f.ownerActor, input), {
      ...deleted,
      deduplicated: true,
    });
    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          ...input,
          roomId: f.workspace.controlRoom.roomId,
        }),
      /idempotency/i,
    );
  } finally {
    f.close();
  }
});

test("failed post-commit blob GC is recovered idempotently on the next Kernel start", async () => {
  const f = fixture();
  const originalRoot = join(f.directory, "room-files");
  const heldRoot = join(f.directory, "room-files-held");
  try {
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "recovery.txt",
      idempotencyKey: "recovery-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    renameSync(originalRoot, heldRoot);
    symlinkSync(heldRoot, originalRoot, "dir");

    const deleted = f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "recovery-delete",
      roomId: f.channel.room.roomId,
    });
    assert.equal(deleted.fileGc.failed, 1);
    assert.equal(existsSync(join(heldRoot, upload.attachmentId)), true);
    f.kernel.close();
    rmSync(originalRoot);
    renameSync(heldRoot, originalRoot);

    const reopened = new RoomKernel({ databasePath: f.databasePath });
    reopened.initialize();
    assert.equal(existsSync(join(originalRoot, upload.attachmentId)), false);
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    const receipt = database
      .prepare(
        "SELECT state,attempt_count,last_error FROM room_file_gc_receipts WHERE attachment_id=?",
      )
      .get(upload.attachmentId);
    database.close();
    assert.deepEqual(
      { ...receipt },
      {
        attempt_count: 2,
        last_error: null,
        state: "reclaimed",
      },
    );
    reopened.close();
  } finally {
    try {
      f.kernel.close();
    } catch {}
    rmSync(f.directory, { force: true, recursive: true });
  }
});

test("a mid-transaction deletion fault rolls back the Room graph, receipts, and blob ownership", async () => {
  const f = fixture();
  try {
    const message = f.kernel.postRoomMessage(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      body: "must survive a rolled-back deletion",
      idempotencyKey: "rollback-message",
      roomId: f.channel.room.roomId,
    });
    const upload = f.kernel.files.prepare(f.ownerActor, {
      filename: "rollback.txt",
      idempotencyKey: "rollback-file",
      mimeType: "text/plain",
      roomId: f.channel.room.roomId,
      size: 5,
    });
    await f.kernel.files.upload(
      f.ownerActor,
      upload.attachmentId,
      bytes("hello"),
    );
    f.kernel.postRoomMessage(f.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: f.head(),
      body: "",
      idempotencyKey: "rollback-file-message",
      roomId: f.channel.room.roomId,
    });
    const blob = join(f.directory, "room-files", upload.attachmentId);

    const fault = new DatabaseSync(f.databasePath);
    fault.exec(`CREATE TRIGGER room_delete_fault
      BEFORE DELETE ON messages
      WHEN OLD.message_id = '${message.event.aggregateId}'
      BEGIN
        SELECT RAISE(ABORT, 'injected room deletion fault');
      END;`);
    fault.close();

    assert.throws(
      () =>
        f.kernel.deleteWorkspaceRoom(f.ownerActor, {
          basedOnRoomSeq: f.head(),
          idempotencyKey: "rollback-delete",
          roomId: f.channel.room.roomId,
        }),
      /injected room deletion fault/i,
    );
    assert.equal(existsSync(blob), true);
    assert.equal(
      f.kernel
        .listRooms(f.ownerActor, {
          workspaceId: f.workspace.workspace.workspaceId,
        })
        .some(({ roomId }) => roomId === f.channel.room.roomId),
      true,
    );
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM room_deletion_receipts WHERE room_id=?",
          )
          .get(f.channel.room.roomId)?.count ?? 0,
      ),
      0,
    );
    assert.equal(
      Number(
        database
          .prepare("SELECT COUNT(*) AS count FROM room_files WHERE room_id=?")
          .get(f.channel.room.roomId)?.count ?? 0,
      ),
      1,
    );
    database.close();
  } finally {
    f.close();
  }
});

test("deleting a cross-Room Reminder target clears its durable Reminder graph without deleting the source Room", () => {
  const f = fixture();
  try {
    const controlRoomId = f.workspace.controlRoom.roomId;
    const source = f.kernel.createWorkspaceRoom(f.ownerActor, {
      basedOnControlRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-control-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      idempotencyKey: "cross-reminder-source-room",
      kind: "channel",
      name: "Reminder source",
      slug: "reminder-source",
      visibility: "private",
      workspaceId: f.workspace.workspace.workspaceId,
    }).room;
    const agent = f.kernel.provisionPrincipal({
      handle: "reminder-owner",
      kind: "agent",
    });
    f.kernel.addMember(f.ownerActor, {
      principalId: agent.principal.principalId,
      roomId: controlRoomId,
    });
    const policy = f.kernel.createExecutionPolicy(f.ownerActor, {
      basedOnRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-policy-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      controlRoomId,
      idempotencyKey: "cross-reminder-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "process",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry-policy",
        contentDigest: digest("c"),
        versionId: "retry-policy-v1",
      },
      sessionPolicy: "fresh",
    });
    const definition = f.kernel.createAgentDefinition(f.ownerActor, {
      basedOnRoomSeq: f.kernel.sync(f.ownerActor, {
        consumerId: "cross-reminder-definition-head",
        roomId: controlRoomId,
      }).latestRoomSeq,
      controlRoomId,
      executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
      idempotencyKey: "cross-reminder-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: digest("d"),
        versionId: "memory-policy-v1",
      },
      participantId: agent.principal.principalId,
      role: "Reminder owner",
      skillRefs: [],
    });
    const anchor = f.kernel.postRoomMessage(f.ownerActor, {
      body: "Cross-Room Reminder anchor",
      idempotencyKey: "cross-reminder-anchor",
      roomId: source.roomId,
    });
    const database = new DatabaseSync(f.databasePath);
    const now = "2026-09-03T00:00:00.000Z";
    database
      .prepare(
        `INSERT INTO reminders(
           reminder_id,owner_agent_id,owner_participant_id,room_id,
           target_room_id,thread_id,root_message_id,title,fire_at,fire_at_ms,
           status,message_id,payload_json,repeat_rule,timezone,version,
           created_at,updated_at
         ) VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?,NULL,NULL,NULL,1,?,?)`,
      )
      .run(
        "reminder_cross_target",
        definition.definition.agentDefinitionId,
        agent.principal.principalId,
        source.roomId,
        f.channel.room.roomId,
        "Target will be deleted",
        "2027-09-03T00:00:00.000Z",
        Date.parse("2027-09-03T00:00:00.000Z"),
        "scheduled",
        anchor.event.aggregateId,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO reminder_events(
           event_id,reminder_id,event_type,actor_type,actor_id,occurred_at,
           next_fire_at,metadata_json
         ) VALUES(?,?,'scheduled','agent',?,?,?,NULL)`,
      )
      .run(
        "reminder_event_cross_target",
        "reminder_cross_target",
        agent.principal.principalId,
        now,
        "2027-09-03T00:00:00.000Z",
      );
    database.close();

    f.kernel.deleteWorkspaceRoom(f.ownerActor, {
      basedOnRoomSeq: f.head(),
      idempotencyKey: "cross-reminder-target-delete",
      roomId: f.channel.room.roomId,
    });

    const audited = new DatabaseSync(f.databasePath, { readOnly: true });
    assert.equal(
      Number(
        audited
          .prepare(
            "SELECT COUNT(*) AS count FROM reminders WHERE reminder_id=?",
          )
          .get("reminder_cross_target")?.count ?? 0,
      ),
      0,
    );
    assert.equal(
      Number(
        audited
          .prepare(
            "SELECT COUNT(*) AS count FROM reminder_events WHERE reminder_id=?",
          )
          .get("reminder_cross_target")?.count ?? 0,
      ),
      0,
    );
    audited.close();
    assert.equal(
      f.kernel.getMessageContext(f.ownerActor, {
        messageId: anchor.event.aggregateId,
        roomId: source.roomId,
      }).message.body,
      "Cross-Room Reminder anchor",
    );
  } finally {
    f.close();
  }
});

test("the explicit Room eraser covers every table whose foreign keys can reach rooms", () => {
  const f = fixture();
  try {
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => String(row.name));
    const edges: Array<{ from: string; to: string }> = [];
    for (const table of tables) {
      for (const foreignKey of database
        .prepare(`PRAGMA foreign_key_list("${table}")`)
        .all()) {
        edges.push({ from: table, to: String(foreignKey.table) });
      }
    }
    database.close();
    const reachable = new Set(["rooms"]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of edges) {
        if (reachable.has(edge.to) && !reachable.has(edge.from)) {
          reachable.add(edge.from);
          changed = true;
        }
      }
    }
    assert.deepEqual(
      [...reachable].sort(),
      [...ROOM_DELETION_REFERENCED_TABLES].sort(),
    );
  } finally {
    f.close();
  }
});
