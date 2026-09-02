import assert from "node:assert/strict";
import test from "node:test";

import {
  addSearchHistory,
  clearSearchHistory,
  readFrequentSearches,
  readSearchHistory,
} from "../src/search-history.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("Search history is bounded, deduplicated and isolated by Workspace", () => {
  const storage = memoryStorage();
  addSearchHistory(storage, "workspace-a", "  memory index  ");
  addSearchHistory(storage, "workspace-a", "room files");
  addSearchHistory(storage, "workspace-a", "MEMORY INDEX");
  addSearchHistory(storage, "workspace-b", "other");
  assert.deepEqual(readSearchHistory(storage, "workspace-a"), [
    "MEMORY INDEX",
    "room files",
  ]);
  assert.deepEqual(readSearchHistory(storage, "workspace-b"), ["other"]);
  assert.deepEqual(readFrequentSearches(storage, "workspace-a"), [
    "MEMORY INDEX",
  ]);
  clearSearchHistory(storage, "workspace-a");
  assert.deepEqual(readSearchHistory(storage, "workspace-a"), []);
});
