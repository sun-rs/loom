import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function sourceLineCount(path: URL): number {
  return readFileSync(path, "utf8").trimEnd().split(/\r?\n/u).length;
}

test("RoomKernel stays below its deliberate source-size ratchet", () => {
  const roomKernelLines = sourceLineCount(
    new URL("../../kernel/src/room-kernel.ts", import.meta.url),
  );

  assert.ok(
    roomKernelLines <= 6_925,
    `room-kernel.ts has ${roomKernelLines} lines; extract an owner-aligned module instead of raising the 6,925-line ratchet`,
  );
});

test("the protocol entry point stays below its deliberate source-size ratchet", () => {
  const protocolEntryLines = sourceLineCount(
    new URL("../../protocol/src/index.ts", import.meta.url),
  );

  assert.ok(
    protocolEntryLines <= 1_800,
    `protocol/src/index.ts has ${protocolEntryLines} lines; extract a domain schema module instead of raising the 1,800-line ratchet`,
  );
});
