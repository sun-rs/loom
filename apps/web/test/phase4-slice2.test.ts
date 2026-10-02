import assert from "node:assert/strict";
import test from "node:test";
import { RahClientError } from "@rah-os/client-sdk";
import { RoleWrite } from "../src/role-write.ts";
import { parseChannelDirectories } from "../src/channel-settings-input.ts";

test("channel directories use canonical absolute-path constraints", () => {
  assert.deepEqual(parseChannelDirectories(" /tmp/project\n\n/tmp/other "), [
    "/tmp/project",
    "/tmp/other",
  ]);
  assert.throws(() => parseChannelDirectories("relative/project"));
  assert.throws(() =>
    parseChannelDirectories(
      Array.from({ length: 17 }, (_, i) => `/tmp/p${i}`).join("\n"),
    ),
  );
});

test("revision intent freezes displayed revision and survives a replacement view", async () => {
  const intent = new RoleWrite();
  const seen: unknown[] = [];
  const payload = {
    roleId: "role_one",
    expectedRoleRevisionId: "revision_one",
    configuration: { displayName: "edited" },
  };
  await assert.rejects(
    intent.run(
      payload,
      async () => 7,
      async (request) => {
        seen.push(request);
        throw new Error("lost after commit");
      },
    ),
  );
  payload.expectedRoleRevisionId = "revision_two";
  await intent.run(
    payload,
    async () => 99,
    async (request) => {
      seen.push(request);
      return true;
    },
  );
  assert.deepEqual(seen[0], seen[1]);
  assert.equal(
    (seen[1] as typeof payload).expectedRoleRevisionId,
    "revision_one",
  );
});

test("revision refusal unlocks and parallel submit cannot duplicate", async () => {
  const intent = new RoleWrite();
  await assert.rejects(
    intent.run(
      { expectedRoleRevisionId: "old" },
      async () => 1,
      async () => {
        throw new RahClientError("conflict", "reload", 409);
      },
    ),
  );
  assert.equal(intent.state, "idle");
  let release!: () => void;
  let count = 0;
  const first = intent.run(
    { expectedRoleRevisionId: "new" },
    async () => 2,
    async () => {
      count++;
      await new Promise<void>((r) => (release = r));
    },
  );
  await assert.rejects(
    intent.run(
      {},
      async () => 2,
      async () => {
        count++;
      },
    ),
  );
  await new Promise((r) => setImmediate(r));
  release();
  await first;
  assert.equal(count, 1);
});
