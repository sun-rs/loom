import assert from "node:assert/strict";
import test from "node:test";
import type { Workspace } from "@rah-os/protocol";
import {
  moveWorkspaceOrder,
  readWorkspaceOrder,
  rememberWorkspaceLocation,
  resolveWorkspaceLocation,
  workspacePreferenceKey,
  writeWorkspaceOrder,
} from "../src/workspace-switcher-state.ts";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();
  get length() {
    return this.#values.size;
  }
  clear() {
    this.#values.clear();
  }
  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#values.delete(key);
  }
  setItem(key: string, value: string) {
    this.#values.set(key, value);
  }
}

const workspaces = ["alpha", "beta", "gamma"].map(
  (workspaceId, index) =>
    ({
      workspaceId,
      name: workspaceId,
      slug: workspaceId,
      state: "active",
      createdAt: `2026-09-02T00:00:0${index}.000Z`,
    }) satisfies Workspace,
);

test("Workspace order is Human-scoped, canonical-list bounded, and appends newly visible identities", () => {
  const storage = new MemoryStorage();
  writeWorkspaceOrder(storage, "human-a", ["beta", "ghost", "alpha"]);
  assert.deepEqual(readWorkspaceOrder(storage, "human-a", workspaces), [
    "beta",
    "alpha",
    "gamma",
  ]);
  assert.deepEqual(readWorkspaceOrder(storage, "human-b", workspaces), [
    "alpha",
    "beta",
    "gamma",
  ]);
  storage.setItem(workspacePreferenceKey("human-a", "order"), "not-json");
  assert.deepEqual(readWorkspaceOrder(storage, "human-a", workspaces), [
    "alpha",
    "beta",
    "gamma",
  ]);
});

test("Workspace drag order moves one identity once and ignores missing targets", () => {
  assert.deepEqual(
    moveWorkspaceOrder(["alpha", "beta", "gamma"], "gamma", "alpha"),
    ["gamma", "alpha", "beta"],
  );
  assert.deepEqual(
    moveWorkspaceOrder(["alpha", "beta", "gamma"], "beta", "missing"),
    ["alpha", "beta", "gamma"],
  );
});

test("Remembered Workspace location restores only a Room that still belongs to the target Workspace", () => {
  const storage = new MemoryStorage();
  rememberWorkspaceLocation(
    storage,
    "human-a",
    "alpha",
    "?room=room-a&thread=room-a%3Aroot-a&surface=room",
  );
  assert.equal(
    resolveWorkspaceLocation(storage, "human-a", "alpha", new Set(["room-a"])),
    "?room=room-a&thread=room-a%3Aroot-a&surface=room",
  );
  assert.equal(
    resolveWorkspaceLocation(
      storage,
      "human-a",
      "alpha",
      new Set(["other-room"]),
    ),
    undefined,
  );
  assert.equal(
    resolveWorkspaceLocation(storage, "human-b", "alpha", new Set(["room-a"])),
    undefined,
  );
});

test("Remembered global surfaces are bounded and unsafe or oversized values fail closed", () => {
  const storage = new MemoryStorage();
  rememberWorkspaceLocation(storage, "human-a", "alpha", "?surface=tasks");
  assert.equal(
    resolveWorkspaceLocation(storage, "human-a", "alpha", new Set()),
    "?surface=tasks",
  );
  rememberWorkspaceLocation(
    storage,
    "human-a",
    "alpha",
    `?surface=search&q=${"x".repeat(5000)}`,
  );
  assert.equal(
    resolveWorkspaceLocation(storage, "human-a", "alpha", new Set()),
    undefined,
  );
  rememberWorkspaceLocation(storage, "human-a", "alpha", "?surface=unknown");
  assert.equal(
    resolveWorkspaceLocation(storage, "human-a", "alpha", new Set()),
    undefined,
  );
  rememberWorkspaceLocation(
    storage,
    "human-a",
    "alpha",
    "?surface=agents&agent=agent-from-another-workspace",
  );
  assert.equal(
    resolveWorkspaceLocation(storage, "human-a", "alpha", new Set()),
    undefined,
  );
});
