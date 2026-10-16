import test from "node:test";
import assert from "node:assert/strict";
import {
  appendActivityPage,
  readActivityWindow,
  MAX_ACTIVITY_PAGES,
} from "../../frontends/raft/loom/activity-window.ts";
const page = (ids: string[], nextCursor?: string) => ({
  rows: ids.map((id) => ({ id })),
  total: 100,
  nextCursor,
});
test("activity continuation retains stable rows, deduplicates overlapping pages and bounds the window", () => {
  const first = page(["a", "b"], "next");
  const result = appendActivityPage(first, page(["b", "c"]));
  assert.deepEqual(
    result.rows.map((r) => r.id),
    ["a", "b", "c"],
  );
  assert.equal(result.rows[1], first.rows[1]);
  assert.equal(
    appendActivityPage(
      page(Array.from({ length: 200 }, (_, i) => String(i))),
      page(["extra"]),
    ).rows.length,
    200,
  );
});
test("return rebuilds the loaded window from fresh cursors, not stale stored cursors", async () => {
  const requests: (string | undefined)[] = [];
  const result = await readActivityWindow(async (cursor) => {
    requests.push(cursor);
    return cursor ? page(["b"]) : page(["a"], "fresh-cursor");
  }, 2);
  assert.deepEqual(requests, [undefined, "fresh-cursor"]);
  assert.deepEqual(
    result.data.rows.map((r) => r.id),
    ["a", "b"],
  );
  assert.equal(result.pages, 2);
});
test("continuation failure retains accepted rows and never retries in a loop", async () => {
  let calls = 0;
  const result = await readActivityWindow(async (cursor) => {
    calls++;
    if (cursor) throw Error("network");
    return page(["a"], "next");
  }, 3);
  assert.equal(calls, 2);
  assert.equal(result.incomplete, true);
  assert.deepEqual(
    result.data.rows.map((r) => r.id),
    ["a"],
  );
  assert.equal(result.data.nextCursor, "next");
});
test("end-of-list, repeated cursor and page budget stop replay", async () => {
  let calls = 0;
  const repeated = await readActivityWindow(async () => {
    calls++;
    return page(["a"], "same");
  }, 999);
  assert.equal(calls, 2);
  assert.equal(repeated.data.nextCursor, undefined);
  calls = 0;
  await readActivityWindow(async () => {
    calls++;
    return page([String(calls)], String(calls));
  }, 999);
  assert.equal(calls, MAX_ACTIVITY_PAGES);
});
