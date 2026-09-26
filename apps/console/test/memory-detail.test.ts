import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemoryEntryDetail,
  MemoryHistoryResponse,
  MemoryReadResponse,
} from "@rah-os/protocol";

import { createMemoryDetailLoader } from "../src/memory-detail.ts";

// Review P2-3: the console memory detail must never show (or act on) entry A
// while entry B is selected. FIXTURE ONLY: every identifier below is fake.
const NOW = "2026-09-27T08:00:00.000Z";

function detail(entryId: string): MemoryEntryDetail {
  return {
    body: `FIXTURE body of ${entryId}`,
    channelId: "channel-fixture",
    createdAt: NOW,
    description: "FIXTURE",
    entryId,
    name: `fixture-${entryId}`,
    pinned: false,
    provenance: {
      actorKind: "human",
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
    revision: 1,
    state: "active",
    type: "project",
    updatedAt: NOW,
  } as MemoryEntryDetail;
}

function history(entryId: string): MemoryHistoryResponse {
  const { body: _body, provenance: _provenance, ...entry } = detail(entryId);
  return { entry, revisions: [], truncated: false };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function fakeApi() {
  const reads = new Map<string, Deferred<MemoryReadResponse>>();
  const histories = new Map<string, Deferred<MemoryHistoryResponse>>();
  const aborted: string[] = [];
  const take = <T>(map: Map<string, Deferred<T>>, id: string) => {
    const next = deferred<T>();
    map.set(id, next);
    return next.promise;
  };
  return {
    reads,
    histories,
    aborted,
    api: {
      read: (entryId: string, signal: AbortSignal) => {
        signal.addEventListener("abort", () => aborted.push(`read:${entryId}`));
        return take(reads, entryId);
      },
      history: (entryId: string, signal: AbortSignal) => {
        signal.addEventListener("abort", () =>
          aborted.push(`history:${entryId}`),
        );
        return take(histories, entryId);
      },
    },
  };
}

const flush = () => new Promise((done) => setImmediate(done));

test("A then B with B answering first: A's late read and history never replace B", async () => {
  const fake = fakeApi();
  const loader = createMemoryDetailLoader(fake.api, () => undefined);
  const a = loader.select("A");
  assert.equal(loader.state().actionable, false, "switching disables actions");
  const b = loader.select("B");
  fake.reads.get("B")!.resolve({ entry: detail("B") });
  await flush();
  fake.histories.get("B")!.resolve(history("B"));
  await b;
  assert.equal(loader.state().current?.entryId, "B");
  assert.equal(loader.state().history?.entry.entryId, "B");
  assert.equal(loader.state().actionable, true);
  fake.reads.get("A")!.resolve({ entry: detail("A") });
  await a;
  await flush();
  assert.equal(loader.state().selectedId, "B");
  assert.equal(loader.state().current?.entryId, "B");
  assert.equal(loader.state().history?.entry.entryId, "B");
  assert.ok(
    fake.aborted.includes("read:A"),
    "the superseded request is abandoned",
  );
});

test("an old history arriving late after reselection is dropped, and a history must match its entry", async () => {
  const fake = fakeApi();
  const loader = createMemoryDetailLoader(fake.api, () => undefined);
  const first = loader.select("A");
  fake.reads.get("A")!.resolve({ entry: detail("A") });
  await flush();
  const staleHistory = fake.histories.get("A")!;
  const second = loader.select("B");
  fake.reads.get("B")!.resolve({ entry: detail("B") });
  await flush();
  staleHistory.resolve(history("A"));
  await first;
  await flush();
  assert.equal(loader.state().current?.entryId, "B");
  assert.equal(
    loader.state().history,
    undefined,
    "A's history never shows under B",
  );
  // A server answer for another entry is refused even in the current load.
  fake.histories.get("B")!.resolve(history("A"));
  await second;
  assert.equal(loader.state().history, undefined);
});

test("stopping the panel abandons unfinished loads", async () => {
  const fake = fakeApi();
  const changes: string[] = [];
  const loader = createMemoryDetailLoader(fake.api, (state) =>
    changes.push(state.current?.entryId ?? "-"),
  );
  const pending = loader.select("A");
  loader.stop();
  const before = changes.length;
  fake.reads.get("A")!.resolve({ entry: detail("A") });
  await pending;
  await flush();
  assert.equal(changes.length, before, "no update after stop");
  assert.equal(loader.state().current, undefined);
  assert.ok(fake.aborted.includes("read:A"));
});
