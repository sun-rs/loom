import assert from "node:assert/strict";
import test from "node:test";
import { runningWorkbench } from "../src/local-core-workbench.ts";

for (const outcome of ["reject", "unexpected-exit", "stop"] as const) {
  test(`local gateway follows daemon ${outcome}`, async () => {
    let resolve!: () => void;
    let reject!: (reason: Error) => void;
    const applicationRun = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const shutdown = new AbortController();
    let gatewayStops = 0;
    shutdown.signal.addEventListener("abort", () => resolve());
    const running = runningWorkbench({
      applicationRun,
      shutdown,
      descriptor: {
        defaultRoomId: "room",
        persistent: true,
        runtimes: [],
        stateDirectory: "/tmp/unused",
        webOrigin: "http://127.0.0.1:4199",
        workspaceCwd: "/tmp/unused",
        workspaceId: "workspace",
      },
      gateway: {
        async stop() {
          gatewayStops += 1;
        },
      },
    });
    let failure: Error | undefined;
    void running.failed?.then((error) => {
      failure = error;
    });
    if (outcome === "stop") await running.stop();
    else if (outcome === "reject") reject(new Error("injected daemon failure"));
    else resolve();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    if (outcome === "stop") assert.equal(failure, undefined);
    else {
      assert.ok(failure, "background exit must reach launcher");
      assert.match(
        failure.message,
        outcome === "reject" ? /injected daemon failure/ : /unexpectedly/,
      );
    }
    assert.equal(gatewayStops, 1, "dead backend must not leave a live gateway");
    await running.stop();
    assert.equal(gatewayStops, 1);
  });
}
