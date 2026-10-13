import assert from "node:assert/strict";
import { test } from "node:test";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";

test("Side HTTP authenticates Human and replays Kernel result without another copy", async () => {
  const f = roleInstanceFixture();
  let copies = 0;
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("unused");
    },
    sideDiscard: (actor, request) => f.kernel.roles.discardSide(actor, request),
    sideCreate: (actor, request) =>
      f.kernel.roles.createSide(actor, f.host, request, async () => {
        copies++;
      }),
  });
  try {
    const run = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: run.run.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
    });
    run.finish(0);
    await service.start();
    const input = {
      instanceId: f.instance.instanceId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "http-fork",
    };
    const send = (token?: string) =>
      fetch(`${service.origin}/v3/client/sides/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });
    assert.equal((await send()).status, 401);
    assert.equal(copies, 0);
    const response = await send(f.owner.accessToken);
    assert.equal(response.status, 200, await response.clone().text());
    const first = (await response.json()) as {
      side: { instanceId: string; roomId: string };
    };
    assert.notEqual(first.side.instanceId, f.instance.instanceId);
    assert.equal((await send(f.owner.accessToken)).status, 200);
    assert.equal(copies, 1);
    const discard = {
      sideId: first.side.instanceId,
      basedOnRoomSeq: f.head(first.side.roomId),
      idempotencyKey: "http-discard",
    };
    const sendDiscard = (token?: string) =>
      fetch(`${service.origin}/v3/client/sides/discard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(discard),
      });
    assert.equal((await sendDiscard()).status, 401);
    assert.equal((await sendDiscard(f.owner.accessToken)).status, 200);
    const replay = await sendDiscard(f.owner.accessToken);
    assert.equal(replay.status, 200);
    assert.equal(
      ((await replay.json()) as { deduplicated: boolean }).deduplicated,
      true,
    );
  } finally {
    await service.close();
    f.close();
  }
});
