import assert from "node:assert/strict";
import test from "node:test";
import { RahClientError } from "@rah-os/client-sdk";
import { RoleWrite } from "../src/role-write.ts";

test("unknown Role write retries frozen payload, key and basis; verification refusal retains intent", async () => {
  const write = new RoleWrite();
  const requests: unknown[] = [];
  let calls = 0;
  const input = { configuration: { displayName: "first" } };
  const send = async (request: unknown) => {
    requests.push(request);
    calls++;
    if (calls === 1) throw new Error("lost response after commit");
    if (calls === 2) throw new RahClientError("forbidden", "forbidden", 403);
    return "role_1";
  };
  await assert.rejects(write.run(input, async () => 5, send));
  assert.equal(write.unknown, true);
  input.configuration.displayName = "changed";
  await assert.rejects(write.run(input, async () => 20, send));
  assert.equal(write.unknown, true);
  assert.equal(await write.run(input, async () => 20, send), "role_1");
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(requests[0], requests[2]);
  assert.equal(write.unknown, false);
});

test("definitive first refusal unlocks; concurrent clicks do not send twice", async () => {
  const write = new RoleWrite();
  await assert.rejects(
    write.run(
      { roleId: "one" },
      async () => 1,
      async () => {
        throw new RahClientError("bad_request", "bad", 400);
      },
    ),
  );
  assert.equal(write.unknown, false);
  let finish!: (value: string) => void;
  const pending = write.run(
    { roleId: "two" },
    async () => 2,
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await assert.rejects(
    write.run(
      { roleId: "two" },
      async () => 2,
      async () => "duplicate",
    ),
    /正在/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  finish("instance_2");
  assert.equal(await pending, "instance_2");
});

test("a new view can observe and recover the same unresolved intent", async () => {
  const write = new RoleWrite();
  const states: string[] = [];
  const unsubscribe = write.subscribe(() => states.push(write.state));
  await assert.rejects(
    write.run(
      { roleId: "role_one", channelId: "channel_one" },
      async () => 4,
      async () => {
        throw new Error("lost");
      },
    ),
  );
  assert.equal(write.state, "unknown");
  assert.deepEqual(write.payload, {
    roleId: "role_one",
    channelId: "channel_one",
  });
  await write.run(
    { roleId: "different", channelId: "other" },
    async () => 5,
    async (request) => {
      assert.equal(request.roleId, "role_one");
      return true;
    },
  );
  assert.equal(write.state, "idle");
  assert.ok(states.includes("pending") && states.includes("unknown"));
  unsubscribe();
});
