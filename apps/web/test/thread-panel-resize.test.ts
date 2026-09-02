import assert from "node:assert/strict";
import test from "node:test";

import {
  clampThreadPanelWidth,
  nextThreadPanelWidth,
  readThreadPanelWidth,
  RAFT_THREAD_PANEL_DEFAULT_WIDTH,
  RAFT_THREAD_PANEL_MIN_WIDTH,
  threadPanelMaxWidth,
  writeThreadPanelWidth,
} from "../src/thread-panel-resize.ts";

test("thread panel uses the Raft side-column width contract", () => {
  assert.equal(RAFT_THREAD_PANEL_DEFAULT_WIDTH, 400);
  assert.equal(RAFT_THREAD_PANEL_MIN_WIDTH, 360);
  assert.equal(threadPanelMaxWidth(1280), 768);
  assert.equal(threadPanelMaxWidth(640), 400);
  assert.equal(clampThreadPanelWidth(120, 1280), 360);
  assert.equal(clampThreadPanelWidth(900, 1280), 768);
  assert.equal(clampThreadPanelWidth(417.4, 1280), 417);
});

test("thread panel persists only valid widths under the Raft-derived key", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readThreadPanelWidth(storage, 1280), 400);
  writeThreadPanelWidth(storage, 512, 1280);
  assert.equal(values.get("rah:thread-panel-width"), "512");
  assert.equal(readThreadPanelWidth(storage, 1280), 512);
  values.set("rah:thread-panel-width", "9999");
  assert.equal(readThreadPanelWidth(storage, 1280), 400);
});

test("thread panel keyboard resizing follows a left-edge handle", () => {
  assert.equal(nextThreadPanelWidth(400, "ArrowLeft", 1280), 408);
  assert.equal(nextThreadPanelWidth(400, "ArrowRight", 1280), 392);
  assert.equal(nextThreadPanelWidth(400, "Home", 1280), 360);
  assert.equal(nextThreadPanelWidth(400, "End", 1280), 768);
  assert.equal(nextThreadPanelWidth(400, "Escape", 1280), undefined);
});
