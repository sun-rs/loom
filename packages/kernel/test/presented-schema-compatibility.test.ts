import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { ACTIVATION_PRESENTED_WINDOW_SCHEMA } from "../src/activation-presented-window.ts";

for (const unexpected of [false, true]) {
  test(`legacy presented schema ${unexpected ? "rejects unknown constraint" : "migrates without inventing acknowledgement"}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "rah-presented-schema-"));
    const path = join(directory, "room.db");
    let kernel = new RoomKernel({ databasePath: path });
    try {
      kernel.initialize();
      kernel.close();
      const db = new DatabaseSync(path);
      db.exec(
        "PRAGMA foreign_keys=OFF; DROP TABLE activation_presented_windows",
      );
      let legacy = ACTIVATION_PRESENTED_WINDOW_SCHEMA.replace(
        "presented_seqs_json",
        "message_seqs_json",
      )
        .replace("rendered_at", "presented_at")
        .replace(
          "  sent_at TEXT,\n  sent_by_host_id TEXT,\n  pending_ack_seq INTEGER,\n  memory_json TEXT,\n",
          "",
        );
      if (unexpected) legacy = legacy.replace("from_seq > 0", "from_seq >= 0");
      db.exec(legacy);
      db.prepare(
        "INSERT INTO activation_presented_windows VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "historical",
        "consumer",
        "run",
        1,
        2,
        "[1,2]",
        "digest",
        "2026-09-18",
      );
      db.close();
      kernel = new RoomKernel({ databasePath: path });
      if (unexpected) {
        assert.throws(() => kernel.initialize(), /unrecognized schema drift/);
        return;
      }
      assert.ok(
        RoomKernel.inspectSchemaState(path).pending.some(
          (x) => x.name === "table:activation_presented_windows",
        ),
      );
      kernel.initialize();
      kernel.initialize();
      const read = new DatabaseSync(path, { readOnly: true });
      try {
        assert.deepEqual(
          {
            ...read.prepare("SELECT * FROM activation_presented_windows").get(),
          },
          {
            activation_id: "historical",
            consumer_id: "consumer",
            run_attempt_id: "run",
            from_seq: 1,
            to_seq: 2,
            presented_seqs_json: "[1,2]",
            content_digest: "digest",
            rendered_at: "2026-09-18",
            sent_at: null,
            sent_by_host_id: null,
            pending_ack_seq: null,
            memory_json: null,
          },
        );
        assert.equal(RoomKernel.inspectSchemaState(path).pending.length, 0);
      } finally {
        read.close();
      }
    } finally {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
