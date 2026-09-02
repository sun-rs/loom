import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chooseThreadFocusReturnTarget } from "../src/thread-focus-return.ts";

type FakeTarget = {
  isConnected: boolean;
  name: string;
};

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Thread focus returns to its connected opener before the root fallback", () => {
  const opener: FakeTarget = { isConnected: true, name: "opener" };
  const root: FakeTarget = { isConnected: true, name: "root" };
  assert.equal(chooseThreadFocusReturnTarget(opener, root), opener);
});

test("Thread focus falls back only to a connected root message", () => {
  const removed: FakeTarget = { isConnected: false, name: "removed" };
  const root: FakeTarget = { isConnected: true, name: "root" };
  assert.equal(chooseThreadFocusReturnTarget(removed, root), root);
  assert.equal(chooseThreadFocusReturnTarget(removed, removed), undefined);
  assert.equal(chooseThreadFocusReturnTarget(undefined, undefined), undefined);
});

test("Thread Escape follows the Raft layer and editable-target contract", () => {
  const pane = read("components/conversation-panes.tsx");
  assert.match(pane, /event\.key !== "Escape" \|\| event\.defaultPrevented/u);
  assert.match(pane, /threadPanelRef\.current\?\.contains\(target\)/u);
  assert.match(pane, /target instanceof HTMLInputElement/u);
  assert.match(pane, /target instanceof HTMLTextAreaElement/u);
  assert.match(pane, /target\.isContentEditable/u);
  assert.match(pane, /event\.preventDefault\(\);\s*onClose\(\)/u);
  assert.match(pane, /closeThreadLayerOnEscape/u);
  assert.match(pane, /event\.stopPropagation\(\)/u);
});

test("Message Thread entry carries its article as the focus opener", () => {
  const pane = read("components/conversation-panes.tsx");
  const app = read("App.tsx");
  assert.match(pane, /threadAction\?\.onClick\(messageRef\.current\)/u);
  assert.match(app, /rememberThreadFocus\(returnFocusTarget\)/u);
  assert.match(app, /restoreThreadFocus\(rootMessageId\)/u);
});
