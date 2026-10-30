import test from "node:test";
import assert from "node:assert/strict";
import { NativeCommands } from "../../frontends/raft/adapter123/commands.ts";
function fixture(state = "stopped") {
  const calls: any[] = [],
    operation = {
      operationId: "op",
      roomId: "channel",
      state,
      pendingTargetCount: state === "stopping" ? 1 : 0,
    };
  const bridge: any = {
    identity: async () => ({
      workspace: { workspaceId: "w", controlRoomId: "control" },
      server: { id: "w" },
    }),
    client: {
      request: async (op: string, input: any) => {
        calls.push([op, input]);
        if (op === "room.sos.stop") return { operation: { ...operation } };
        if (op === "room.sos.resume")
          return { operation: { ...operation, state: "resumed" } };
        if (op === "room.execution.read")
          return { operation: { ...operation } };
        throw Error(op);
      },
    },
  };
  const commands = new NativeCommands(
    bridge,
    () =>
      ({
        syncUntilCurrent: async () => ({
          caughtUp: true,
          state: { latestRoomSeq: 9 },
        }),
      }) as any,
  );
  return { commands, calls, operation };
}
test("native stop-all and resume use the existing durable SOS owner and exact Human guidance, never per-Agent toggles", async () => {
  const f = fixture();
  await f.commands.write("post", "/channels/channel/stop-all-agents");
  await f.commands.write("post", "/channels/channel/resume-all-agents", {
    prompt: "  Human correction  ",
  });
  assert.deepEqual(
    f.calls.map(([op]) => op),
    ["room.sos.stop", "room.sos.resume"],
  );
  assert.equal(f.calls[1][1].guidance, "Human correction");
  assert.equal(f.calls[0][1].basedOnRoomSeq, 9);
  assert.equal(f.calls[0][1].resumeOnMessage, false);
  await assert.rejects(
    () =>
      f.commands.write("post", "/channels/channel/resume-all-agents", {
        prompt: "",
      }),
    /指导/,
  );
});
test("native stopping acknowledgement cannot become an all-stopped success until matching terminal proof is read", async () => {
  const f = fixture("stopping");
  let settled = false;
  const promise = f.commands
    .write("post", "/channels/channel/stop-all-agents")
    .then((result: any) => {
      assert.equal(result.operation.state, "stopped");
      settled = true;
    });
  for (
    let i = 0;
    i < 20 && !f.calls.some(([op]) => op === "room.execution.read");
    i++
  )
    await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  assert.equal(f.calls.filter(([op]) => op === "room.sos.stop").length, 1);
  f.operation.state = "stopped";
  f.operation.pendingTargetCount = 0;
  await f.commands.verify();
  await promise;
  assert.equal(settled, true);
  assert.equal(f.calls.filter(([op]) => op === "room.sos.stop").length, 1);
});
