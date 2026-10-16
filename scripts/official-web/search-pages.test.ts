import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSearchPage,
  MAX_SEARCH_RESULT_ROWS,
} from "../../frontends/raft/loom/search-pages.ts";
test("append preserves identities, deduplicates overlap and adopts the server continuation", () => {
  const result = appendSearchPage(
    { rows: [{ id: "a" }, { id: "b" }], total: 3, nextCursor: "next" },
    { rows: [{ id: "b" }, { id: "c" }], total: 3, nextCursor: undefined },
  );
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.equal(result.nextCursor, undefined);
});
test("search accumulation is bounded without inventing a server end of results", () => {
  const result = appendSearchPage(
    {
      rows: Array.from({ length: MAX_SEARCH_RESULT_ROWS }, (_, i) => ({
        id: String(i),
      })),
      total: 999,
      nextCursor: "next",
    },
    { rows: [{ id: "overflow" }], total: 999, nextCursor: "later" },
  );
  assert.equal(result.rows.length, MAX_SEARCH_RESULT_ROWS);
  assert.equal(result.nextCursor, "later");
});
