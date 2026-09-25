import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { stopOpenCodeServer } from "../src/opencode-server-process.js";

/**
 * Eighth review P2-3: retiring an `opencode serve` returns an explicit exit
 * proof; a child that does not exit after SIGTERM and SIGKILL is never
 * reported as stopped (the caller must not start a replacement then).
 */
test("a child that never exits after SIGTERM and SIGKILL has no exit proof: stop throws", async () => {
  const signals: string[] = [];
  const handle = {
    child: {
      exitCode: null,
      signalCode: null,
      kill(signal: string) {
        signals.push(signal);
        return true;
      },
    },
    exited: new Promise<never>(() => undefined),
  };
  await assert.rejects(
    stopOpenCodeServer(handle, { termTimeoutMs: 20 }),
    /did not exit/u,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("a real child that ignores SIGTERM is killed and its exit is the proof", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.stdout.write('ready')",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const exited = new Promise<{ code: number | null; signal: string | null }>(
    (resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
  );
  const proof = await stopOpenCodeServer(
    { child, exited },
    { termTimeoutMs: 200 },
  );
  assert.deepEqual(proof, { code: null, signal: "SIGKILL" });
});

test("an already exited child is proven without a signal", async () => {
  const signals: string[] = [];
  const proof = await stopOpenCodeServer(
    {
      child: {
        exitCode: 0,
        signalCode: null,
        kill(signal: string) {
          signals.push(signal);
          return true;
        },
      },
      exited: new Promise<never>(() => undefined),
    },
    { termTimeoutMs: 20 },
  );
  assert.deepEqual(proof, { code: 0, signal: null });
  assert.deepEqual(signals, []);
});
