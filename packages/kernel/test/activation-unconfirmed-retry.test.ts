import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

/**
 * A RunAttempt that ended cleanly (exit 0 / native turn success) but neither
 * posted nor acknowledged delivery is not a transient infrastructure failure:
 * backing it off only adds dead time before the reminder wake. The Kernel's
 * retry owner makes exactly that category leasable now and records one
 * Outbox wake hint; every other category keeps the Host's backoff, and the
 * same-error retry fence still counts all of them. Fake clock throughout.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-unconfirmed-retry-"));
  let nowMs = Date.parse("2026-09-25T12:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(directory, "room.db"),
    now: () => new Date(nowMs),
  });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "worker", kind: "agent" });
  const agentId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Main", slug: "main" });
  kernel.addMember(actor, { roomId: room.roomId, principalId: agentId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  kernel.postMessage(actor, {
    body: "please look",
    roomId: room.roomId,
    recipients: [{ participantId: agentId, reason: "mention" }],
    idempotencyKey: "seed",
  });
  const activate = () => {
    const activation = kernel.leaseNextActivation(host, { leaseMs: 600_000 });
    if (activation === null) return null;
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: `runtime-${run.runAttemptId}`,
      recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    const scope = {
      activationId: activation.activationId,
      consumerId: "worker",
      hostId: "host",
      participantId: agentId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    };
    return {
      activation,
      run,
      execution: kernel.authorizeWorkerExecution(host, scope),
    };
  };
  type Attempt = NonNullable<ReturnType<typeof activate>>;
  const end = (
    attempt: Attempt,
    exit: { code: number; state: "exited" | "failed"; error?: string },
  ) => {
    kernel.recordRuntimeTermination(host, {
      exit: { code: exit.code },
      runAttemptId: attempt.run.runAttemptId,
      runtimeRunId: `runtime-${attempt.run.runAttemptId}`,
    });
    kernel.finishRunAttempt(host, {
      runAttemptId: attempt.run.runAttemptId,
      state: exit.state,
      exitCode: exit.code,
      ...(exit.error === undefined ? {} : { error: exit.error }),
    });
  };
  const completionRefusal = (attempt: Attempt): string => {
    try {
      kernel.completeActivation(host, {
        activationId: attempt.activation.activationId,
        consumerId: "worker",
      });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("completion was expected to be refused");
  };
  const wakeHints = (activationId: string) =>
    kernel
      .listOutbox()
      .filter(
        (entry) =>
          entry.topic === "activation.requested" &&
          entry.payload.activationId === activationId,
      );
  const activationRow = (activationId: string) =>
    kernel
      .listActivations({ roomId: room.roomId })
      .find((row) => row.activationId === activationId);
  return {
    activate,
    activationRow,
    advance: (ms: number) => {
      nowMs += ms;
    },
    completionRefusal,
    end,
    host,
    kernel,
    now: () => nowMs,
    wakeHints,
    close() {
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("a clean exit that neither posted nor acknowledged is retried immediately with an Outbox wake hint", () => {
  const f = fixture();
  try {
    const first = f.activate()!;
    const activationId = first.activation.activationId;
    const hintsBefore = f.wakeHints(activationId).length;
    f.end(first, { code: 0, state: "exited" });
    const refusal = f.completionRefusal(first);
    assert.match(refusal, /not acknowledged/u);
    f.kernel.retryActivation(f.host, {
      activationId,
      error: refusal,
      retryAfterMs: 10_000,
    });
    const row = f.activationRow(activationId)!;
    assert.equal(row.state, "queued");
    assert.equal(
      Date.parse(row.availableAt!),
      f.now(),
      "the unconfirmed retry is leasable now, not after the backoff",
    );
    const hints = f.wakeHints(activationId);
    assert.equal(hints.length, hintsBefore + 1, "one new Outbox wake hint");
    assert.equal(hints.at(-1)!.payload.participantId, row.participantId);
    // Leasable without advancing the fake clock.
    const second = f.activate();
    assert.ok(second, "the retry is leased with no clock advance");
    assert.equal(second.activation.activationId, activationId);
    assert.equal(
      f.kernel.presentWorkerMessages(second.execution)
        .previousAttemptUnconfirmed,
      true,
      "the retry still carries the one-line reminder",
    );
  } finally {
    f.close();
  }
});

test("other retry categories keep the Host backoff and add no wake hint", async (t) => {
  const cases: Array<{
    name: string;
    run: (
      f: ReturnType<typeof fixture>,
      attempt: NonNullable<ReturnType<ReturnType<typeof fixture>["activate"]>>,
    ) => string;
  }> = [
    {
      name: "runtime exited with code 1",
      run: (f, attempt) => {
        f.end(attempt, { code: 1, state: "failed", error: "exit 1" });
        return "runtime exited with code 1";
      },
    },
    {
      name: "delivery refusal after a failed run",
      run: (f, attempt) => {
        f.end(attempt, { code: 1, state: "failed", error: "exit 1" });
        return `${f.completionRefusal(attempt)}; run failure: runtime exited with code 1`;
      },
    },
    {
      name: "delivery refusal whose attempt already posted",
      run: (f, attempt) => {
        const posted = f.kernel.postWorkerMessage(attempt.execution, {
          body: "on it",
        });
        assert.ok("event" in posted);
        f.end(attempt, { code: 0, state: "exited" });
        return f.completionRefusal(attempt);
      },
    },
    {
      name: "delivery refusal claimed while the RunAttempt failed",
      run: (f, attempt) => {
        f.end(attempt, { code: 0, state: "failed", error: "turn failed" });
        return f.completionRefusal(attempt);
      },
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const f = fixture();
      try {
        const attempt = f.activate()!;
        const activationId = attempt.activation.activationId;
        const error = scenario.run(f, attempt);
        const hintsBefore = f.wakeHints(activationId).length;
        f.kernel.retryActivation(f.host, {
          activationId,
          error,
          retryAfterMs: 10_000,
        });
        const row = f.activationRow(activationId)!;
        assert.equal(row.state, "queued");
        assert.equal(Date.parse(row.availableAt!), f.now() + 10_000);
        assert.equal(f.wakeHints(activationId).length, hintsBefore);
        assert.equal(f.activate(), null, "not leasable before the backoff");
      } finally {
        f.close();
      }
    });
  }
});

test("repeated unconfirmed clean exits still trip the same-error retry fence", () => {
  const f = fixture();
  try {
    let activationId = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const run = f.activate();
      assert.ok(run, `attempt ${attempt} is leasable immediately`);
      activationId = run.activation.activationId;
      f.end(run, { code: 0, state: "exited" });
      const hintsBefore = f.wakeHints(activationId).length;
      f.kernel.retryActivation(f.host, {
        activationId,
        error: f.completionRefusal(run),
        retryAfterMs: 10_000,
      });
      if (attempt < 3) {
        assert.equal(f.wakeHints(activationId).length, hintsBefore + 1);
      } else {
        assert.equal(
          f.wakeHints(activationId).length,
          hintsBefore,
          "a blocked retry sends no wake hint",
        );
      }
    }
    assert.equal(f.activationRow(activationId)!.state, "quarantined");
  } finally {
    f.close();
  }
});
