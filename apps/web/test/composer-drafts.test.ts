import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ComposerDraftStore } from "../src/composer-drafts.ts";

test("Room, DM and Thread drafts survive presentation unmounts without sharing content", () => {
  const store = new ComposerDraftStore();
  store.update("room:a", {
    body: "room draft",
    asTask: true,
    assigneeId: "alice",
  });
  store.update("room:dm", { body: "private draft" });
  store.update("thread:a", { body: "thread draft" });
  assert.equal(store.read("room:a").body, "room draft");
  assert.equal(store.read("room:a").asTask, true);
  assert.equal(store.read("room:a").assigneeId, "alice");
  assert.equal(store.read("room:dm").body, "private draft");
  assert.equal(store.read("thread:a").body, "thread draft");
  assert.equal(new ComposerDraftStore().read("room:a").body, "");
});

test("canonical acceptance clears only its submitted snapshot, never newer edits or another target", () => {
  const store = new ComposerDraftStore();
  store.update("room:a", { body: "old" });
  const submitted = store.read("room:a");
  store.update("room:a", { body: "new" });
  store.update("room:b", { body: "other" });
  store.accept("room:a", submitted);
  assert.equal(store.read("room:a").body, "new");
  store.accept("room:a", store.read("room:a"));
  assert.equal(store.read("room:a").body, "");
  assert.equal(store.read("room:b").body, "other");
  store.update(undefined, { body: "no identity" });
  assert.equal(store.read(undefined).body, "");
});

test("both composers use the connected-app draft owner, not storage or component-local body state", () => {
  const pane = readFileSync(
    new URL("../src/components/conversation-panes.tsx", import.meta.url),
    "utf8",
  );
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal(pane.match(/useComposerDraft\(/gu)?.length, 2);
  assert.doesNotMatch(pane, /const \[body, setBody\] = useState/u);
  assert.match(app, /<ComposerDraftProvider>\s*<WorkspaceScreen/u);
  assert.match(app, /<\/ComposerDraftProvider>/u);
});

test("Raft Search enters results for active filters even when the keyword is empty", () => {
  const source = readFileSync(
    new URL("../src/components/global-discovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /const searchActive = searchShouldRun\(query/u);
  assert.match(source, /!composing && searchActive/u);
  assert.match(source, /!searchActive \? \(/u);
});
