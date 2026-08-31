import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ResidentRunnerArtifactCollector } from "../src/index.ts";

const staleId = "018f7f8a-2f3a-7c41-8b62-4123d665c102";
const activeId = "018f7f8a-2f3a-7c41-8b62-4123d665c103";
const unknownId = "018f7f8a-2f3a-7c41-8b62-4123d665c104";
const liveId = "018f7f8a-2f3a-7c41-8b62-4123d665c105";
const unacknowledgedId = "018f7f8a-2f3a-7c41-8b62-4123d665c106";

function old(path: string): void {
  const date = new Date("2026-08-20T00:00:00.000Z");
  utimesSync(path, date, date);
}

test("resident artifact collector removes only old, inactive, non-live owned artifacts", async () => {
  const root = mkdtempSync("/tmp/rah-resident-artifact-gc-");
  const controlDirectory = join(root, "control");
  const socketDirectory = join(root, "sockets");
  mkdirSync(controlDirectory, { mode: 0o700 });
  mkdirSync(socketDirectory, { mode: 0o700 });

  const makeInstance = (instanceId: string) => {
    const path = join(controlDirectory, instanceId);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const stalePath = makeInstance(staleId);
  writeFileSync(join(stalePath, "terminal.json"), "{}\n", { mode: 0o600 });
  old(join(stalePath, "terminal.json"));
  old(stalePath);

  const activePath = makeInstance(activeId);
  old(activePath);

  const unknownPath = makeInstance(unknownId);
  writeFileSync(join(unknownPath, "keep.txt"), "owned by somebody else\n", {
    mode: 0o600,
  });
  old(join(unknownPath, "keep.txt"));
  old(unknownPath);

  const livePath = makeInstance(liveId);
  const liveSocketPath = join(socketDirectory, `${liveId}.sock`);
  const liveServer = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    liveServer.once("error", reject);
    liveServer.listen(liveSocketPath, () => {
      liveServer.off("error", reject);
      resolve();
    });
  });
  chmodSync(liveSocketPath, 0o600);
  old(livePath);

  const unacknowledgedPath = makeInstance(unacknowledgedId);
  writeFileSync(join(unacknowledgedPath, "terminal.json"), "{}\n", {
    mode: 0o600,
  });
  old(join(unacknowledgedPath, "terminal.json"));
  old(unacknowledgedPath);

  try {
    const collector = new ResidentRunnerArtifactCollector({
      controlDirectory,
      nowMs: () => Date.parse("2026-08-28T00:00:00.000Z"),
      retentionMs: 24 * 60 * 60_000,
      socketDirectory,
    });
    const result = await collector.collect({
      activeInstanceIds: [activeId],
      retiredInstanceIds: [staleId, unknownId, liveId],
    });

    assert.deepEqual(result.removedInstanceIds, [staleId]);
    assert.deepEqual(result.preservedLiveInstanceIds, [liveId]);
    assert.deepEqual(result.skippedInstanceIds, [unknownId]);
    assert.equal(existsSync(stalePath), false);
    assert.equal(existsSync(activePath), true);
    assert.equal(existsSync(unknownPath), true);
    assert.equal(existsSync(livePath), true);
    assert.equal(
      existsSync(unacknowledgedPath),
      true,
      "old terminal evidence requires an explicit retirement acknowledgement",
    );
  } finally {
    await new Promise<void>((resolve) => liveServer.close(() => resolve()));
    rmSync(root, { force: true, recursive: true });
  }
});

test("resident artifact collector requires absolute owner-private roots", async () => {
  assert.throws(
    () =>
      new ResidentRunnerArtifactCollector({
        controlDirectory: "relative-control",
        socketDirectory: "relative-sockets",
      }),
    /absolute/u,
  );

  const root = mkdtempSync(join(tmpdir(), "rah-resident-artifact-mode-"));
  try {
    const controlDirectory = join(root, "control");
    const socketDirectory = join(root, "sockets");
    mkdirSync(controlDirectory, { mode: 0o755 });
    mkdirSync(socketDirectory, { mode: 0o700 });
    const collector = new ResidentRunnerArtifactCollector({
      controlDirectory,
      socketDirectory,
    });
    await assert.rejects(
      collector.collect({ activeInstanceIds: [], retiredInstanceIds: [] }),
      /owner-private/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
