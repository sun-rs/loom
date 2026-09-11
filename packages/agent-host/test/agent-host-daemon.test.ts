import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "@rah-os/kernel";

import {
  AgentHost,
  AgentHostDaemon,
  DaemonAlreadyRunningError,
  FakeRuntimeAdapter,
  runAgentHostDaemonUntilSignal,
  UnixSocketInstanceLock,
} from "../src/index.ts";

test("AgentHostDaemon publishes online, draining, and offline around graceful shutdown", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-dl-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const participant = kernel.provisionPrincipal({
      handle: "daemon-lifecycle-agent",
      kind: "agent",
    }).principal;
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "daemon-lifecycle-host",
        participantIds: [participant.principalId],
      }).accessToken,
    );
    let stateObservedByRunnerAtAbort: string | undefined;
    const runner = {
      run: async ({ signal }: { signal: AbortSignal }) => {
        assert.equal(kernel.listHosts()[0]?.state, "online");
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              stateObservedByRunnerAtAbort = kernel.listHosts()[0]?.state;
              resolve();
            },
            { once: true },
          );
        });
      },
    };
    const daemon = new AgentHostDaemon({
      host,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId: host.hostId,
      }),
      kernel,
      runner,
    });
    const shutdown = new AbortController();
    const running = daemon.run({ signal: shutdown.signal });
    await waitUntil(() => kernel.listHosts()[0]?.state === "online");

    shutdown.abort();
    await running;

    assert.equal(stateObservedByRunnerAtAbort, "draining");
    assert.equal(kernel.listHosts()[0]?.state, "offline");
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHostDaemon drains an active Activation without cancelling it or leasing follow-up work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-drain-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const humanProvisioning = kernel.provisionPrincipal({
      handle: "daemon-drain-human",
      kind: "human",
    });
    const agentProvisioning = kernel.provisionPrincipal({
      handle: "daemon-drain-agent",
      kind: "agent",
    });
    const human = kernel.authenticateAccessToken(humanProvisioning.accessToken);
    const agent = kernel.authenticateAccessToken(agentProvisioning.accessToken);
    const room = kernel.createRoom(human, {
      name: "Daemon drain",
      slug: "daemon-drain",
    });
    kernel.addMember(human, {
      principalId: agentProvisioning.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(human, {
      body: "finish this before shutdown",
      idempotencyKey: "daemon-drain-first",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "daemon-drain-host",
        participantIds: [agentProvisioning.principal.principalId],
      }).accessToken,
    );
    let releaseRuntime: ((exit: { code: number }) => void) | undefined;
    const runtimeExit = new Promise<{ code: number }>((resolve) => {
      releaseRuntime = resolve;
    });
    const runtime = new FakeRuntimeAdapter({
      onReap: async () => await runtimeExit,
      onStart: (input) => {
        const delivery = kernel.sync(agent, {
          consumerId: input.consumerId,
          roomId: input.roomId,
        });
        kernel.acknowledgeCursor(agent, {
          consumerId: input.consumerId,
          roomId: input.roomId,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const agentHost = new AgentHost({
      host,
      kernel,
      leaseMs: 300,
      leaseRenewIntervalMs: 30,
      runtime,
    });
    const daemon = new AgentHostDaemon({
      host,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId: host.hostId,
      }),
      kernel,
      runner: agentHost,
    });
    const shutdown = new AbortController();
    const running = daemon.run({ signal: shutdown.signal });
    await waitUntil(() => runtime.starts.length === 1);

    shutdown.abort();
    kernel.postMessage(human, {
      body: "leave this queued for the next daemon",
      idempotencyKey: "daemon-drain-follow-up",
      recipients: [
        {
          participantId: agentProvisioning.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(kernel.listHosts()[0]?.state, "draining");
    releaseRuntime?.({ code: 0 });
    await running;

    assert.equal(runtime.cancellations.length, 0);
    assert.deepEqual(
      kernel
        .listActivations({ roomId: room.roomId })
        .map((activation) => activation.state)
        .sort(),
      ["completed", "queued"],
    );
    assert.equal(kernel.listHosts()[0]?.state, "offline");
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHostDaemon cancels and requeues work when the drain deadline expires", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-drain-deadline-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "daemon-deadline-human",
      kind: "human",
    });
    const agent = kernel.provisionPrincipal({
      handle: "daemon-deadline-agent",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(humanActor, {
      name: "Daemon drain deadline",
      slug: "daemon-drain-deadline",
    });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    kernel.postMessage(humanActor, {
      body: "Cancel this hung runtime after the drain grace period",
      idempotencyKey: "daemon-drain-deadline-message",
      recipients: [
        {
          participantId: agent.principal.principalId,
          reason: "mention",
        },
      ],
      roomId: room.roomId,
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "daemon-deadline-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    const runtime = new FakeRuntimeAdapter({
      onReap: async () => await new Promise(() => {}),
    });
    const runner = new AgentHost({
      drainTimeoutMs: 20,
      host,
      kernel,
      leaseMs: 1_000,
      runtime,
      runtimeCancelTimeoutMs: 20,
    });
    const daemon = new AgentHostDaemon({
      host,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId: host.hostId,
      }),
      kernel,
      runner,
    });
    const shutdown = new AbortController();
    const running = daemon.run({ signal: shutdown.signal });
    await waitUntil(() => runtime.starts.length === 1);

    shutdown.abort("deadline-test");
    await running;

    assert.equal(runtime.cancellations.length, 1);
    assert.equal(
      kernel.listActivations({ roomId: room.roomId })[0]?.state,
      "queued",
    );
    assert.equal(kernel.listHosts()[0]?.state, "offline");
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("revoking a running daemon credential still permits clean shutdown and publishes offline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-revoke-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const participant = kernel.provisionPrincipal({
      handle: "daemon-revoke-agent",
      kind: "agent",
    }).principal;
    const credential = kernel.provisionHostCredential({
      hostId: "daemon-revoke-host",
      participantIds: [participant.principalId],
    });
    const host = kernel.authenticateHostAccessToken(credential.accessToken);
    const agentHost = new AgentHost({
      host,
      kernel,
      leaseMs: 300,
      runtime: new FakeRuntimeAdapter(),
    });
    const daemon = new AgentHostDaemon({
      host,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId: host.hostId,
      }),
      kernel,
      runner: agentHost,
    });
    const shutdown = new AbortController();
    const running = daemon.run({ signal: shutdown.signal });
    await waitUntil(() => kernel.listHosts()[0]?.state === "online");

    kernel.revokeHostCredential(credential.credentialId);
    shutdown.abort();
    await running;

    assert.equal(kernel.listHosts()[0]?.state, "offline");
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("UnixSocketInstanceLock rejects a concurrent live owner and can be reacquired", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-lock-"));
  try {
    const first = new UnixSocketInstanceLock({
      directory,
      hostId: "singleton-host",
    });
    const competing = new UnixSocketInstanceLock({
      directory,
      hostId: "singleton-host",
    });

    await first.acquire();
    await assert.rejects(competing.acquire(), DaemonAlreadyRunningError);
    await first.release();
    await competing.acquire();
    await competing.release();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("UnixSocketInstanceLock replaces a stale local socket artifact", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-stale-"));
  try {
    const lock = new UnixSocketInstanceLock({
      directory,
      hostId: "stale-host",
    });
    writeFileSync(lock.socketPath, "stale artifact", { mode: 0o600 });

    await lock.acquire();
    await lock.release();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("UnixSocketInstanceLock rejects a symlink lock directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-link-"));
  try {
    const target = join(directory, "target");
    const link = join(directory, "link");
    const targetLock = new UnixSocketInstanceLock({
      directory: target,
      hostId: "prepare-private-target",
    });
    await targetLock.acquire();
    await targetLock.release();
    symlinkSync(target, link);
    const lock = new UnixSocketInstanceLock({
      directory: link,
      hostId: "symlink-host",
    });

    await assert.rejects(lock.acquire(), /symbolic link/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("AgentHostDaemon validates lock identity and resets after release failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-release-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const participant = kernel.provisionPrincipal({
      handle: "daemon-release-agent",
      kind: "agent",
    }).principal;
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "daemon-release-host",
        participantIds: [participant.principalId],
      }).accessToken,
    );
    assert.throws(
      () =>
        new AgentHostDaemon({
          host,
          instanceLock: {
            acquire: async () => {},
            hostId: "wrong-host",
            release: async () => {},
          },
          kernel,
          runner: { run: async () => {} },
        }),
      /lock identity/,
    );

    let releaseCount = 0;
    const daemon = new AgentHostDaemon({
      host,
      instanceLock: {
        acquire: async () => {},
        hostId: host.hostId,
        release: async () => {
          releaseCount += 1;
          if (releaseCount === 1) throw new Error("release failed");
        },
      },
      kernel,
      runner: { run: async () => {} },
    });

    await assert.rejects(
      daemon.run({ signal: new AbortController().signal }),
      /release failed/,
    );
    await daemon.run({ signal: new AbortController().signal });
    assert.equal(releaseCount, 2);

    const runnerFailure = new Error("runner failed");
    const cleanupFailure = new Error("cleanup failed");
    const dualFailureDaemon = new AgentHostDaemon({
      host,
      instanceLock: {
        acquire: async () => {},
        hostId: host.hostId,
        release: async () => {
          throw cleanupFailure;
        },
      },
      kernel,
      runner: {
        run: async () => {
          throw runnerFailure;
        },
      },
    });
    let combinedFailure: unknown;
    try {
      await dualFailureDaemon.run({ signal: new AbortController().signal });
    } catch (error) {
      combinedFailure = error;
    }
    assert.ok(combinedFailure instanceof AggregateError);
    assert.deepEqual(combinedFailure.errors, [runnerFailure, cleanupFailure]);
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the process signal bridge converts SIGTERM into graceful daemon shutdown and removes listeners", async () => {
  const signals = new EventEmitter();
  let observedAbort = false;
  const daemon = {
    run: async ({ signal }: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
    },
  };

  const running = runAgentHostDaemonUntilSignal(daemon, { signals });
  signals.emit("SIGTERM");
  await running;

  assert.equal(observedAbort, true);
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("daemon waits for prepared workspace offers before starting its runner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-wo-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = false;
  let ran = false;
  const shutdown = new AbortController();
  try {
    kernel.initialize();
    const agent = kernel.provisionPrincipal({
      handle: "online-agent",
      kind: "agent",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "online-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    const daemon = new AgentHostDaemon({
      host,
      kernel,
      instanceLock: new UnixSocketInstanceLock({
        directory: join(directory, "run"),
        hostId: host.hostId,
      }),
      lifecycle: {
        afterOnline: async () => {
          entered = true;
          await ready;
        },
      },
      runner: {
        run: async () => {
          ran = true;
        },
      },
    });
    const running = daemon.run({ signal: shutdown.signal });
    await waitUntil(() => entered);
    const prematurelyStarted = ran;
    release();
    await running;
    assert.equal(prematurelyStarted, false);
    assert.equal(ran, true);
  } finally {
    release();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
