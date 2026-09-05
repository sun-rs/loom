import assert from "node:assert/strict";
import test from "node:test";
import { taskPeopleChoices } from "../src/raft-discovery-controls.ts";

test("official task sentinels reserve alignment without an avatar; real rows keep profile identity", () => {
  const people = [
    { principalId: "me", handle: "owner", kind: "human" },
    {
      principalId: "a",
      handle: "alice",
      displayName: "Alice Display",
      avatarKey: "skull",
      kind: "agent",
    },
  ];
  for (const filter of ["creator", "assignee"] as const) {
    const options = taskPeopleChoices(people, "me", filter);
    assert.equal(options[0]!.sentinel, true);
    assert.equal(options.at(-1)!.sentinel, false);
    assert.equal(options.at(-1)!.label, "Alice Display");
    assert.equal(options.at(-1)!.avatarKey, "skull");
    assert.equal(options.at(-1)!.searchText, "Alice Display alice");
  }
});
