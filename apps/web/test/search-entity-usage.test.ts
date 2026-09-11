import assert from "node:assert/strict";
import test from "node:test";
import {
  recordSearchOpen,
  frequentSearchEntities,
} from "../src/search-entity-usage.ts";
test("frequent search entries are opened entities, not repeated queries; clear history does not clear usage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const now = Date.now();
  const entries = [
    { key: "room:a", title: "Alpha" },
    { key: "room:b", title: "Beta" },
  ];
  assert.deepEqual(frequentSearchEntities(storage, "one", entries, now), []);
  recordSearchOpen(storage, "one", "room:a", now - 100);
  recordSearchOpen(storage, "one", "room:b", now);
  recordSearchOpen(storage, "one", "room:a", now);
  assert.deepEqual(
    frequentSearchEntities(storage, "one", entries, now).map((e) => e.key),
    ["room:a", "room:b"],
  );
  assert.deepEqual(frequentSearchEntities(storage, "two", entries, now), []);
  assert.deepEqual(frequentSearchEntities(storage, "one", [], now), []);
  assert.deepEqual(
    frequentSearchEntities(storage, "one", entries, now + 91 * 86400000),
    [],
  );
});
