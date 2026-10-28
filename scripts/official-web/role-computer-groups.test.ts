import test from "node:test";
import assert from "node:assert/strict";
import {
  groupRolesByComputer,
  roleComputer,
  readCollapsedComputers,
} from "../../frontends/raft/loom/role-computer-groups.ts";
test("computer grouping preserves role identity/order and does not mix retired configuration", () => {
  const input = [
    { id: "role-1", computer: { id: "host-2", name: "Studio" } },
    { id: "role-2", computer: { id: "host-1", name: "Laptop" } },
    { id: "replacement", computer: { id: "host-2", name: "Studio" } },
    { id: "retired", retired: true },
    { id: "unknown" },
  ];
  const groups = groupRolesByComputer(input);
  assert.deepEqual(
    groups.map((g) => g.entries.map((e) => e.id)),
    [["role-1", "replacement"], ["role-2"], ["unknown"]],
  );
  assert.equal(groups[0].name, "Studio");
});
test("unknown binding is never assigned to the local Computer merely by ID prefix", () => {
  const inventory = {
    hostId: "local",
    computer: { displayName: "My Mac" },
    runtimes: [{ runtimeOfferId: "exact-offer" }],
  } as Parameters<typeof roleComputer>[1];
  assert.deepEqual(roleComputer("exact-offer", inventory), {
    id: "local",
    name: "My Mac",
  });
  assert.equal(roleComputer("local-other-offer", inventory), undefined);
  assert.equal(roleComputer("exact-offer", undefined), undefined);
});
test("collapsed UI preference tolerates invalid/unavailable browser storage", () => {
  assert.deepEqual(
    readCollapsedComputers({ getItem: () => '["host"]' }, "key"),
    ["host"],
  );
  assert.deepEqual(
    readCollapsedComputers({ getItem: () => "[true]" }, "key"),
    [],
  );
  assert.deepEqual(
    readCollapsedComputers(
      {
        getItem: () => {
          throw Error("denied");
        },
      },
      "key",
    ),
    [],
  );
});
