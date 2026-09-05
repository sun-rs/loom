import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { RoomLedger } from "../packages/runtime-daemon/src/room/room-ledger";

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

const messages = positiveInteger(process.argv[2], 5_000, "messages");
const bodyBytes = positiveInteger(process.argv[3], 64, "bodyBytes");
const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-baseline-"));
const databasePath = path.join(root, "room-ledger.sqlite");
const rssBefore = process.memoryUsage().rss;
const ledger = new RoomLedger(databasePath, {
  createId: (() => {
    let next = 0;
    return (prefix: string) => `${prefix}-${++next}`;
  })(),
});

try {
  ledger.provisionPrincipal({
    principalId: "human-owner",
    handle: "owner",
    kind: "human",
  });
  ledger.createRoom("human-owner", {
    roomId: "room-baseline",
    workspaceKey: "workspace-baseline",
    kind: "channel",
    slug: "baseline",
    name: "Baseline",
    idempotencyKey: "create-baseline",
  });

  const body = "x".repeat(bodyBytes);
  const writeStarted = performance.now();
  for (let index = 0; index < messages; index += 1) {
    ledger.postMessage("human-owner", {
      roomId: "room-baseline",
      body,
      idempotencyKey: `message-${index + 1}`,
    });
  }
  const writeMs = performance.now() - writeStarted;

  const readStarted = performance.now();
  const page = ledger.syncRoom("human-owner", {
    roomId: "room-baseline",
    bootstrap: "latest",
    limit: 500,
  });
  const readMs = performance.now() - readStarted;
  if (page.mode !== "latest_bootstrap") throw new Error("expected latest bootstrap");

  ledger.close();
  const rssAfter = process.memoryUsage().rss;
  process.stdout.write(`${JSON.stringify({
    node: process.version,
    messages,
    bodyBytes,
    writeMs: Number(writeMs.toFixed(2)),
    writesPerSecond: Number((messages / (writeMs / 1_000)).toFixed(2)),
    latestReadMs: Number(readMs.toFixed(2)),
    latestMessageCount: page.recentMessages.length,
    responseBytes: page.responseBytes,
    databaseBytes: statSync(databasePath).size,
    rssDeltaBytes: rssAfter - rssBefore,
  }, null, 2)}\n`);
} finally {
  ledger.close();
  rmSync(root, { recursive: true, force: true });
}
