import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  HELD_MESSAGE_DRAFT_TTL_MS,
  expireHeldMessageDrafts,
  migrateHeldMessageDraftLifecycle,
  requireActiveHeldMessageDraft,
} from "../src/held-message-drafts.ts";

test("legacy held drafts gain Raft's ten-minute local draft lifetime and expire durably", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE held_message_drafts (
        held_draft_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        activation_id TEXT NOT NULL,
        thread_id TEXT,
        body TEXT NOT NULL,
        based_on_room_seq INTEGER NOT NULL,
        seen_up_to_seq INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO held_message_drafts VALUES(
        'held-legacy', 'room-1', 'agent-1', 'activation-1', NULL,
        'A saved answer', 3, 4, 'held-legacy-key', 'held',
        '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z'
      );
    `);
    migrateHeldMessageDraftLifecycle(database);
    const createdAtMs = Date.parse("2026-09-02T00:00:00.000Z");
    assert.equal(
      requireActiveHeldMessageDraft(database, {
        heldDraftId: "held-legacy",
        nowMs: createdAtMs + HELD_MESSAGE_DRAFT_TTL_MS - 1,
      }).rehold_count,
      1,
    );
    assert.equal(
      expireHeldMessageDrafts(database, {
        nowMs: createdAtMs + HELD_MESSAGE_DRAFT_TTL_MS - 1,
        resolvedAt: "2026-09-02T00:09:59.999Z",
      }),
      0,
    );
    assert.equal(
      expireHeldMessageDrafts(database, {
        nowMs: createdAtMs + HELD_MESSAGE_DRAFT_TTL_MS,
        resolvedAt: "2026-09-02T00:10:00.000Z",
      }),
      1,
    );
    assert.deepEqual(
      {
        ...database
          .prepare(
            "SELECT state, resolution_kind, resolved_at FROM held_message_drafts WHERE held_draft_id = 'held-legacy'",
          )
          .get(),
      },
      {
        resolution_kind: "expired",
        resolved_at: "2026-09-02T00:10:00.000Z",
        state: "replaced",
      },
    );
    assert.throws(
      () =>
        requireActiveHeldMessageDraft(database, {
          heldDraftId: "held-legacy",
          nowMs: createdAtMs + HELD_MESSAGE_DRAFT_TTL_MS,
        }),
      /no longer active/u,
    );
  } finally {
    database.close();
  }
});
