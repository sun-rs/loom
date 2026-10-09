import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GenericProcessAdapter,
  type ActivationEnvelope,
} from "../src/index.ts";

const input: ActivationEnvelope = {
  activationId: "a",
  consumerId: "c",
  fromSeq: 1,
  hostId: "h",
  participantId: "p",
  reason: "mention",
  roomId: "r",
  runAttemptId: "run-settlement",
  toSeq: 1,
};
const frame = {
  protocol: "rah-provider-session/v1",
  provider: "fixture-provider/v1",
  providerSessionId: "native-session",
  state: "ready",
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function start(adapter: GenericProcessAdapter, direct: boolean) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    // Exercise the existing Windows direct branch without introducing a runtime option.
    if (direct)
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "win32",
      });
    return await adapter.start(input, {
      registerPrepared: async () => undefined,
    });
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
}

for (const direct of [false, true]) {
  const mode = direct ? "direct" : "supervised";
  test(`process final settlement (${mode}): drains acceptance before callback and releases original lease last`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-final-settle-"));
    const order: string[] = [];
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      cwd: directory,
      args: [
        "-e",
        `require('node:fs').writeSync(3, ${JSON.stringify(JSON.stringify(frame) + "\n")}); process.exitCode=7;`,
      ],
      supervisorDirectory: join(directory, "supervisors"),
      recordProviderSessionEvidence: async () => {
        await new Promise((r) => setTimeout(r, 30));
        order.push("drained");
      },
      activationEnvironment: () => ({
        env: {},
        settleFinalOutput: async (exit, signal) => {
          order.push("settled");
          assert.deepEqual(order, ["drained", "settled"]);
          assert.equal(exit.code, 7);
          assert.equal(signal.aborted, false);
          return {
            state: "rejected",
            detail: "native failure; no publication",
          };
        },
        release: () => {
          order.push("released");
        },
      }),
    });
    try {
      const run = await start(adapter, direct);
      const result = await adapter.reap(run);
      assert.deepEqual(order, ["drained", "settled", "released"]);
      assert.equal(result.code, 7);
      assert.equal(result.finalOutput?.state, "rejected");
      assert.deepEqual(await adapter.reap(run), result);
      assert.equal(order.length, 3, "settlement once");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test(`process final settlement (${mode}): callback failure remains unknown and still releases, preserving native exit`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-final-throw-"));
    let releases = 0;
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      cwd: directory,
      args: ["-e", "process.exitCode=3"],
      supervisorDirectory: join(directory, "supervisors"),
      activationEnvironment: () => ({
        env: {},
        settleFinalOutput: () => {
          throw Error("response lost after possible commit");
        },
        release: () => {
          releases++;
        },
      }),
    });
    try {
      const run = await start(adapter, direct);
      const result = await adapter.reap(run);
      assert.equal(result.code, 3);
      assert.equal(result.finalOutput?.state, "unknown");
      assert.equal(releases, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test(`process final settlement (${mode}): cancel aborts HTTP settlement even after native exit`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "loom-final-abort-"));
    const entered = deferred();
    let releases = 0;
    let calls = 0;
    const adapter = new GenericProcessAdapter({
      command: process.execPath,
      cwd: directory,
      args: ["-e", "process.exitCode=0"],
      supervisorDirectory: join(directory, "supervisors"),
      activationEnvironment: () => ({
        env: {},
        settleFinalOutput: async (exit, signal) => {
          calls++;
          assert.equal(exit.code, 0);
          entered.resolve();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else
              signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return { state: "unknown", detail: "cancelled pending request" };
        },
        release: () => {
          releases++;
        },
      }),
    });
    try {
      const run = await start(adapter, direct);
      await Promise.race([
        entered.promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("settlement not entered")), 3000),
        ),
      ]);
      assert.equal(releases, 0);
      const result = await adapter.cancel(run);
      assert.equal(result.code, 0);
      assert.equal(result.finalOutput?.state, "unknown");
      assert.equal(releases, 1);
      assert.equal(calls, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("process final settlement recovery: volatile native proof is unknown, never re-published", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-final-recovery-"));
  let settlements = 0;
  const base = {
    command: process.execPath,
    cwd: directory,
    args: ["-e", "process.exitCode=0"],
    supervisorDirectory: join(directory, "supervisors"),
  };
  const adapter = new GenericProcessAdapter({
    ...base,
    activationEnvironment: () => ({
      env: {},
      settleFinalOutput: () => {
        settlements++;
        return { state: "published", detail: "one live callback" };
      },
    }),
  });
  try {
    const run = await start(adapter, false);
    assert.equal((await adapter.reap(run)).finalOutput?.state, "published");
    assert.equal(
      run.recoveryDescriptor?.metadata.finalOutputSettlement,
      "volatile/v1",
    );
    const replacement = new GenericProcessAdapter(base);
    const recovered = await replacement.recover({
      recoveryDescriptor: run.recoveryDescriptor!,
      runAttemptId: input.runAttemptId,
      runtimeRunId: run.runId,
    });
    assert.equal(recovered.code, 0);
    assert.equal(recovered.finalOutput?.state, "unknown");
    assert.equal(settlements, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("process final settlement retains drained provider failure independently of transport receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-final-failure-"));
  const failureFrame = {
    observedAt: new Date().toISOString(),
    producerSequence: 1,
    entry: {
      kind: "status",
      activity: "error",
      detailKind: "runtime_error",
      detail: "Authentication failed: please log in first",
    },
  };
  const adapter = new GenericProcessAdapter({
    command: process.execPath,
    cwd: directory,
    args: [
      "-e",
      `require('node:fs').writeSync(3, ${JSON.stringify(JSON.stringify(failureFrame) + "\n")}); process.exitCode=1;`,
    ],
    supervisorDirectory: join(directory, "supervisors"),
    activationEnvironment: () => ({
      env: {},
      settleFinalOutput: (exit) => {
        assert.equal(exit.failure?.errorClass, "AuthError");
        return { state: "rejected", detail: "native authentication failed" };
      },
    }),
  });
  try {
    const run = await adapter.start(input, {
      registerPrepared: async () => undefined,
      recordTrajectory: async () => undefined,
    });
    const result = await adapter.reap(run);
    assert.equal(result.code, 1);
    assert.equal(result.failure?.errorClass, "AuthError");
    assert.equal(result.failure?.retryDisposition, "action_required");
    assert.equal(result.finalOutput?.state, "rejected");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
