import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the Human HTTP adapter depends on a narrow application port, not RoomKernel", () => {
  const source = readFileSync(
    new URL("../src/client-application-service.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /HumanApplicationPort/u);
  assert.doesNotMatch(source, /\bRoomKernel\b/u);
  assert.doesNotMatch(source, /#kernel/u);
});
