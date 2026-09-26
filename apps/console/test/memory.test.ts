import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient, RahClientError } from "@rah-os/client-sdk";
import type {
  MemoryEntry,
  MemoryPolicy,
  MemoryProvenance,
} from "@rah-os/protocol";

import { WriteIntentSlot, hasUnresolvedIntents } from "../src/actions.ts";
import {
  MEMORY_DELETE_BOUNDARY,
  MEMORY_IMPORT_NOTE,
  buildImportRequest,
  buildMemoryChange,
  buildPolicyUpdate,
  deleteConfirmText,
  importResultLabel,
  isRevisionConflict,
  memoryStateLabel,
  policyFormFrom,
  provenanceLabel,
  sendMemoryChange,
} from "../src/memory.ts";

// FIXTURE ONLY: every identifier and text below is fake test data.
const NOW = "2026-09-27T08:00:00.000Z";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    channelId: "channel-fixture",
    createdAt: NOW,
    description: "FIXTURE memory description",
    entryId: "memory-fixture-1",
    name: "fixture-note",
    pinned: false,
    revision: 3,
    state: "active",
    type: "project",
    updatedAt: NOW,
    ...overrides,
  };
}

function detail(value: MemoryEntry, body: string | null) {
  return {
    ...value,
    body,
    provenance: {
      actorKind: "human" as const,
      actorPrincipalId: "human-fixture",
      basedOnRoomSeq: null,
      instanceId: null,
      modelBindingId: null,
      modelReasoning: null,
      recordedAt: NOW,
      roleId: null,
      roleRevisionId: null,
      runAttemptId: null,
      sessionGeneration: null,
      viaRoomId: null,
    },
  };
}

function mutationEvent(roomSeq: number) {
  return {
    actorId: "human-fixture",
    aggregateId: "memory-fixture-1",
    aggregateType: "memory_entry",
    createdAt: NOW,
    eventId: `event-fixture-${String(roomSeq)}`,
    idempotencyKey: `key-fixture-${String(roomSeq)}`,
    payload: {},
    roomId: "channel-fixture",
    roomSeq,
    schemaVersion: 1,
    type: "memory.entry_changed",
  };
}

test("the delete confirmation states the exact deletion boundary and needs a reason", () => {
  assert.equal(
    MEMORY_DELETE_BOUNDARY,
    "删除后平台在线读取与检索不再能取得正文；不追溯清理已进入 session、诊断、备份或 SQLite 物理残留（WAL）的副本。",
  );
  const text = deleteConfirmText(entry());
  assert.ok(text.includes(MEMORY_DELETE_BOUNDARY));
  assert.ok(text.includes("fixture-note"));
  assert.ok(text.includes("修订 3"));

  const missing = buildMemoryChange("delete", entry(), "   ");
  assert.equal(missing.ok, false);
  const change = buildMemoryChange("delete", entry(), "  FIXTURE privacy  ");
  assert.deepEqual(change, {
    ok: true,
    value: {
      op: "memory.delete",
      payload: {
        entryId: "memory-fixture-1",
        expectedRevision: 3,
        reason: "FIXTURE privacy",
      },
    },
  });
  assert.equal(
    buildMemoryChange("delete", entry({ state: "deleted" }), "x").ok,
    false,
    "a deleted entry cannot be deleted again",
  );
});

test("every memory change carries the entry's current revision; invalidate needs a reason and fits the state", () => {
  assert.equal(buildMemoryChange("invalidate", entry(), "").ok, false);
  assert.deepEqual(buildMemoryChange("invalidate", entry(), "stale fact"), {
    ok: true,
    value: {
      op: "memory.invalidate",
      payload: {
        entryId: "memory-fixture-1",
        expectedRevision: 3,
        reason: "stale fact",
      },
    },
  });
  assert.equal(
    buildMemoryChange("invalidate", entry({ state: "invalidated" }), "x").ok,
    false,
  );
  assert.equal(buildMemoryChange("restore", entry()).ok, false);
  assert.deepEqual(
    buildMemoryChange("restore", entry({ revision: 5, state: "invalidated" })),
    {
      ok: true,
      value: {
        op: "memory.restore",
        payload: { entryId: "memory-fixture-1", expectedRevision: 5 },
      },
    },
  );
  assert.deepEqual(buildMemoryChange("pin", entry()), {
    ok: true,
    value: {
      op: "memory.pin",
      payload: {
        entryId: "memory-fixture-1",
        expectedRevision: 3,
        pinned: true,
      },
    },
  });
  assert.deepEqual(buildMemoryChange("unpin", entry({ pinned: true })), {
    ok: true,
    value: {
      op: "memory.pin",
      payload: {
        entryId: "memory-fixture-1",
        expectedRevision: 3,
        pinned: false,
      },
    },
  });
  assert.equal(buildMemoryChange("pin", entry({ pinned: true })).ok, false);
  assert.equal(buildMemoryChange("pin", entry({ state: "deleted" })).ok, false);
  assert.equal(
    buildMemoryChange("invalidate", entry(), "x".repeat(501)).ok,
    false,
    "the reason limit is the protocol's",
  );
});

test("a memory write intent keeps one key and frozen payload through an unknown result and its verification", async () => {
  const sent: Array<{ operation: string; input: Record<string, unknown> }> = [];
  let loseResponse = true;
  const committed = new Set<string>();
  const client = new FakeRahClient(async (operation, input) => {
    const request = input as Record<string, unknown>;
    sent.push({ input: request, operation });
    const key = String(request.idempotencyKey);
    const deduplicated = committed.has(key);
    committed.add(key);
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError("network lost after commit (fixture)");
    }
    return {
      deduplicated,
      entry: detail(entry({ pinned: true, revision: 4 }), "FIXTURE body"),
      event: mutationEvent(9),
    };
  });
  const change = buildMemoryChange("pin", entry());
  assert.ok(change.ok);
  const slot = new WriteIntentSlot();
  const first = await slot.submitRevisioned({
    action: "memory-pin",
    payload: change.value,
    send: (payload, idempotencyKey) =>
      sendMemoryChange(client, payload, idempotencyKey),
  });
  assert.equal(first.kind, "unknown");
  assert.equal(slot.state, "unknown");
  assert.equal(hasUnresolvedIntents(), true, "leaving the page asks first");
  const retried = await slot.retry();
  assert.equal(retried.kind, "ok");
  assert.equal(
    (retried as { result: { deduplicated: boolean } }).result.deduplicated,
    true,
  );
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.operation, "memory.pin");
  assert.deepEqual(sent[0]!.input, sent[1]!.input, "identical replay");
  assert.equal(sent[0]!.input.expectedRevision, 3);
  assert.match(String(sent[0]!.input.idempotencyKey), /^console-memory-pin-/u);
  assert.equal(slot.state, "idle");
  assert.equal(hasUnresolvedIntents(), false);
});

test("a revision mismatch (HTTP 409) is an explicit refusal, recognised as a conflict", async () => {
  const client = new FakeRahClient(async () => {
    throw new RahClientError(
      "conflict",
      "memory 'fixture-note' is at revision 4, not 3; read it again before changing it",
      409,
    );
  });
  const change = buildMemoryChange("invalidate", entry(), "stale fact");
  assert.ok(change.ok);
  const slot = new WriteIntentSlot();
  const outcome = await slot.submitRevisioned({
    action: "memory-invalidate",
    payload: change.value,
    send: (payload, idempotencyKey) =>
      sendMemoryChange(client, payload, idempotencyKey),
  });
  assert.equal(outcome.kind, "rejected");
  assert.equal(slot.state, "idle");
  assert.equal(isRevisionConflict((outcome as { error: unknown }).error), true);
  assert.equal(
    isRevisionConflict(new RahClientError("stale_context", "newer", 409)),
    false,
  );
  assert.equal(
    isRevisionConflict(new RahClientError("forbidden", "no", 403)),
    false,
  );
  assert.equal(isRevisionConflict(new TypeError("offline")), false);
});

function policy(overrides: Partial<MemoryPolicy> = {}): MemoryPolicy {
  return {
    channelId: "channel-fixture",
    members: [
      { instanceId: "instance-a", read: true, write: false },
      { instanceId: "instance-b", read: true, write: true },
    ],
    overrides: [{ instanceId: "instance-a", read: null, write: false }],
    readDefault: true,
    revision: 2,
    writeDefault: true,
    ...overrides,
  };
}

test("policy updates send only changed defaults and overrides, with the policy's revision", () => {
  const base = policy();
  const form = policyFormFrom(base);
  assert.deepEqual(form, {
    overrides: {
      "instance-a": { read: "inherit", write: "off" },
      "instance-b": { read: "inherit", write: "inherit" },
    },
    readDefault: true,
    writeDefault: true,
  });
  assert.deepEqual(buildPolicyUpdate(base, form), {
    error: "没有修改",
    ok: false,
  });

  const changed = policyFormFrom(base);
  changed.writeDefault = false;
  changed.overrides["instance-b"] = { read: "off", write: "inherit" };
  assert.deepEqual(buildPolicyUpdate(base, changed), {
    ok: true,
    value: {
      channelId: "channel-fixture",
      expectedRevision: 2,
      overrides: [{ instanceId: "instance-b", read: false, write: null }],
      writeDefault: false,
    },
  });

  const removed = policyFormFrom(base);
  removed.overrides["instance-a"] = { read: "inherit", write: "inherit" };
  assert.deepEqual(buildPolicyUpdate(base, removed), {
    ok: true,
    value: {
      channelId: "channel-fixture",
      expectedRevision: 2,
      overrides: [{ instanceId: "instance-a", read: null, write: null }],
    },
  });

  const fresh = policy({ overrides: [], revision: 0 });
  const on = policyFormFrom(fresh);
  on.overrides["instance-a"] = { read: "on", write: "on" };
  on.readDefault = false;
  assert.deepEqual(buildPolicyUpdate(fresh, on), {
    ok: true,
    value: {
      channelId: "channel-fixture",
      expectedRevision: 0,
      overrides: [{ instanceId: "instance-a", read: true, write: true }],
      readDefault: false,
    },
  });
});

test("provenance names the author kind and instance, and an import's source", () => {
  const base: MemoryProvenance = detail(entry(), null).provenance;
  const label = (id: string) => (id === "instance-a" ? "Reviewer @rev" : id);
  assert.equal(provenanceLabel(base, label), "Human（human-fixture）");
  const imported = provenanceLabel(
    { ...base, importedFrom: { instanceId: "instance-a", path: "notes/x.md" } },
    label,
  );
  assert.ok(imported.startsWith("Human（human-fixture）"));
  assert.ok(imported.includes("导入自实例 Reviewer @rev 的 notes/x.md"));
  const worker = provenanceLabel(
    {
      ...base,
      actorKind: "instance",
      actorPrincipalId: "instance-a",
      instanceId: "instance-a",
      modelBindingId: "gpt-console-fixture",
      modelReasoning: "high",
      runAttemptId: "run-fixture",
      sessionGeneration: 2,
    },
    label,
  );
  assert.ok(worker.startsWith("实例 Reviewer @rev"));
  assert.ok(worker.includes("gpt-console-fixture/high"));
  assert.ok(worker.includes("session 代数 2"));
  assert.ok(worker.includes("run-fixture"));
  const unknownModel = provenanceLabel(
    {
      ...base,
      actorKind: "instance",
      actorPrincipalId: "instance-a",
      instanceId: "instance-a",
    },
    label,
  );
  assert.ok(
    unknownModel.includes("模型 未知"),
    "null is unknown, never guessed",
  );
  assert.equal(memoryStateLabel("active"), "有效");
  assert.equal(memoryStateLabel("invalidated"), "已失效");
  assert.equal(memoryStateLabel("deleted"), "已删除");
});

test("legacy import is an explicit one-off request; per-file paths are optional and only in files mode", () => {
  assert.ok(MEMORY_IMPORT_NOTE.includes("MEMORY.md"));
  assert.ok(MEMORY_IMPORT_NOTE.includes("notes"));
  assert.ok(MEMORY_IMPORT_NOTE.includes("一次性"));
  assert.deepEqual(
    buildImportRequest("channel-fixture", "instance-a", "whole", ""),
    {
      ok: true,
      value: {
        channelId: "channel-fixture",
        instanceId: "instance-a",
        mode: "whole",
      },
    },
  );
  assert.equal(
    buildImportRequest("channel-fixture", "instance-a", "whole", "notes/a.md")
      .ok,
    false,
    "whole mode takes no file selection",
  );
  assert.deepEqual(
    buildImportRequest(
      "channel-fixture",
      "instance-a",
      "files",
      " notes/a.md \n\nMEMORY.md\n",
    ),
    {
      ok: true,
      value: {
        channelId: "channel-fixture",
        instanceId: "instance-a",
        mode: "files",
        relativePaths: ["notes/a.md", "MEMORY.md"],
      },
    },
  );
  assert.deepEqual(
    buildImportRequest("channel-fixture", "instance-a", "files", ""),
    {
      ok: true,
      value: {
        channelId: "channel-fixture",
        instanceId: "instance-a",
        mode: "files",
      },
    },
  );
  assert.equal(
    importResultLabel({
      entryId: "memory-fixture-1",
      name: "fixture-note",
      path: "notes/a.md",
      status: "created",
    }),
    "notes/a.md：已创建 fixture-note",
  );
  assert.equal(
    importResultLabel({
      entryId: "memory-fixture-1",
      name: "fixture-note",
      path: "notes/a.md",
      status: "existing",
    }),
    "notes/a.md：已导入过（fixture-note）",
  );
  assert.equal(
    importResultLabel({
      path: "notes/b.md",
      reason: "memory body is required",
      status: "skipped",
    }),
    "notes/b.md：跳过（memory body is required）",
  );
});
