import assert from "node:assert/strict";
import test from "node:test";

import { isWorkerShortRef, shortWorkerRef } from "../src/index.ts";

test("a canonical message or Thread id shortens to its first 8 UUID hex chars", () => {
  assert.equal(
    shortWorkerRef("message_eb064ecc-1111-4222-8333-444455556666"),
    "eb064ecc",
  );
  assert.equal(
    shortWorkerRef("thread_0a1b2c3d-1111-4222-8333-444455556666"),
    "0a1b2c3d",
  );
});

test("an id that is not canonical is never shortened", () => {
  for (const id of [
    "message-12",
    "message_eb064ecc",
    "room_eb064ecc-1111-4222-8333-444455556666",
    "",
  ])
    assert.equal(shortWorkerRef(id), id);
});

test("only an 8+ char lowercase hex UUID prefix is a short ref", () => {
  assert.equal(isWorkerShortRef("eb064ecc"), true);
  assert.equal(isWorkerShortRef("eb064ecc-1111"), true);
  assert.equal(isWorkerShortRef("eb064ec"), false);
  assert.equal(isWorkerShortRef("message_eb064ecc"), false);
  assert.equal(isWorkerShortRef("EB064ECC"), false);
  assert.equal(isWorkerShortRef("eb06%ecc"), false);
});
