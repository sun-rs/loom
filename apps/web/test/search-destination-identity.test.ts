import assert from "node:assert/strict";
import test from "node:test";
import { uniqueSearchDestinations } from "../src/search-visible-results.ts";
test("DM and directory collapse by principal identity, distinct same-name people survive", () => {
  const dm = { key: "room:dm", principalId: "p1", title: "Kimi" },
    person = { key: "person:p1", principalId: "p1", title: "Kimi" },
    other = { key: "person:p2", principalId: "p2", title: "Kimi" },
    channel = { key: "room:channel", title: "Kimi" };
  assert.deepEqual(uniqueSearchDestinations([dm, person, other, channel]), [
    dm,
    other,
    channel,
  ]);
  assert.deepEqual(uniqueSearchDestinations([person, other]), [person, other]);
});
