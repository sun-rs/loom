import assert from "node:assert/strict";
import { test } from "node:test";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../kernel/test/role-instance-fixture.ts";

test("Fork HTTP authenticates Human and replays Kernel result without another copy", async () => {
  const f = roleInstanceFixture();
  let copies = 0;
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("unused");
    },
    instanceFork: (actor, request) =>
      f.kernel.roles.forkInstance(actor, f.host, request, async () => {
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
      fetch(`${service.origin}/v3/client/instances/fork`, {
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
      instance: { instanceId: string };
    };
    assert.notEqual(first.instance.instanceId, f.instance.instanceId);
    assert.equal((await send(f.owner.accessToken)).status, 200);
    assert.equal(copies, 1);
  } finally {
    await service.close();
    f.close();
  }
});
