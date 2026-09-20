import assert from "node:assert/strict";
import test from "node:test";
import type { Workspace } from "@rah-os/protocol";
import {
  moveWorkspaceOrder,
  readWorkspaceOrder,
  rememberWorkspaceLocation,
  recallWorkspaceSurface,
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

test("surface selections survive other pages independently and remain scoped to human/workspace", () => {
  const storage = new MemoryStorage();
  rememberWorkspaceLocation(
    storage,
    "human",
    "alpha",
    "?surface=agents&memberView=relationship",
  );
  rememberWorkspaceLocation(storage, "human", "alpha", "?room=dm_alice");
  rememberWorkspaceLocation(storage, "human", "alpha", "?surface=settings");
  assert.equal(
    recallWorkspaceSurface(storage, "human", "alpha", "agents"),
    "?surface=agents&memberView=relationship",
  );
  assert.equal(
    recallWorkspaceSurface(storage, "human", "alpha", "room"),
    "?room=dm_alice",
  );
  assert.equal(
    recallWorkspaceSurface(storage, "human", "beta", "room"),
    undefined,
  );
  assert.equal(
    recallWorkspaceSurface(storage, "other", "alpha", "room"),
    undefined,
  );
  rememberWorkspaceLocation(storage, "human", "alpha", "?surface=room");
  assert.equal(
    recallWorkspaceSurface(storage, "human", "alpha", "room"),
    "?surface=room",
  );
});

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

test("chat list destinations share chat memory without overwriting members", () => {
  const storage = new MemoryStorage();
  rememberWorkspaceLocation(
    storage,
    "human",
    "alpha",
    "?surface=agents&agent=a",
  );
  for (const surface of ["saved", "room"]) {
    rememberWorkspaceLocation(storage, "human", "alpha", `?surface=${surface}`);
    rememberWorkspaceLocation(storage, "human", "alpha", "?surface=settings");
    assert.equal(
      recallWorkspaceSurface(storage, "human", "alpha", "room"),
      `?surface=${surface}`,
    );
    assert.equal(
      recallWorkspaceSurface(storage, "human", "alpha", "agents"),
      "?surface=agents&agent=a",
    );
  }
});

test("independent search/activity pages never capture the Chat navigation destination", () => {
  const storage = new MemoryStorage();
  for (const previous of [
    "?surface=room&room=room-a",
    "?surface=saved",
    "?surface=room",
  ]) {
    rememberWorkspaceLocation(storage, "human", "alpha", previous);
    for (const surface of ["search", "activity", "settings", "tasks"]) {
      rememberWorkspaceLocation(
        storage,
        "human",
        "alpha",
        `?surface=${surface}`,
      );
      assert.equal(
        recallWorkspaceSurface(storage, "human", "alpha", "room"),
        previous,
      );
    }
  }
  for (const surface of ["search", "activity"]) {
    storage.setItem(
      "rah:workspace-switcher:v1:human:location:alpha:room",
      `?surface=${surface}`,
    );
    assert.equal(
      recallWorkspaceSurface(storage, "human", "alpha", "room"),
      undefined,
    );
  }
});
