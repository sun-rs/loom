import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

// Explicitly resumes the preserved Codex session from the failed scenario;
// never creates a replacement fixture and calls that an old-session pass.
test(
  "opt-in original Codex session preserves B -> A -> DM -> A targets",
  {
    skip: process.env.RAH_CODEX_TARGET_CONTINUITY_GATE !== "1",
    timeout: 15 * 60_000,
  },
  async () => {
    const directory = process.env.RAH_CORE_CHECKPOINT_DIRECTORY;
    assert.ok(directory && directory.includes("rah-core-chain-"));
    const stateDirectory = join(directory, "state");
    const workspace = join(directory, "workspace");
    const db = new DatabaseSync(join(stateDirectory, "room.db"), {
      readOnly: true,
    });
    const participantId = String(
      db
        .prepare("SELECT principal_id FROM principals WHERE handle='steady-c'")
        .get()?.principal_id,
    );
    assert.ok(participantId.startsWith("principal_"));
    const sessions = () =>
      readdirSync(join(stateDirectory, "supervisors/provider-sessions"))
        .filter((name) => name.endsWith(".json"))
        .map((name) =>
          JSON.parse(
            readFileSync(
              join(stateDirectory, "supervisors/provider-sessions", name),
              "utf8",
            ),
          ),
        )
        .filter(
          (row) =>
            row.participantId === participantId &&
            row.provider === "codex-app-server/v1",
        );
    const initialSessions = sessions();
    assert.equal(initialSessions.length, 1);
    const sessionId = initialSessions[0].providerSessionId as string;
    const busy = () =>
      Number(
        db
          .prepare(
            "SELECT count(*) n FROM activations WHERE participant_id=? AND state IN ('queued','leased','quarantined')",
          )
          .get(participantId)?.n,
      ) > 0;
    assert.equal(
      busy(),
      false,
      "original Codex work must be idle before continuation",
    );
    const specs = ["kimi", "opencode", "codex"].map((cli) => {
      const spec = localCliRuntimeSpec(cli, workspace);
      assert.ok(spec);
      return spec;
    });
    const prepared = await prepareLocalWorkbench({
      runtimeSpecs: specs,
      stateDirectory,
      workspaceCwd: workspace,
    });
    const observer = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    observer.initialize();
    const actor = observer.authenticateHumanAccessToken(
      prepared.humanAccessToken,
    );
    const agent = observer
      .listAgentCatalog(actor, {
        controlRoomId: prepared.metadata.controlRoomId,
      })
      .find((entry) => entry.definition.participantId === participantId)!;
    assert.ok(agent);
    const revisionId = agent.definition.currentRevisionId;
    const policy = observer.getExecutionPolicyRevision(
      agent.currentRevision.executionPolicyRevisionId,
    );
    assert.deepEqual(policy.modelIntent.exactBindingIds, [
      "local:codex-cli/v1:gpt-5.6-luna",
    ]);
    assert.equal(policy.modelIntent.reasoning, "low");
    // V4 participantIds is a subset check, not a scheduling filter. Use an
    // actually narrow credential, keeping Agent identities and sessions intact.
    const gateCredential = observer.provisionHostCredential({
      hostId: prepared.config.host.hostId,
      participantIds: [participantId],
    });
    const gateSecret = join(
      stateDirectory,
      `codex-target-gate-${Date.now()}.secret`,
    );
    writeFileSync(gateSecret, gateCredential.accessToken, {
      mode: 0o600,
      flag: "wx",
    });
    const baselineRunRowid = Number(
      db.prepare("SELECT coalesce(max(rowid),0) n FROM run_attempts").get()?.n,
    );
    const config = {
      ...prepared.config,
      host: {
        ...prepared.config.host,
        participantIds: [participantId],
        credential: { path: gateSecret, source: "file" as const },
        maxConcurrent: 1,
      },
    };
    const app = new DaemonApplication({ config });
    const abort = new AbortController();
    const running = app.run({ signal: abort.signal });
    const samples: Array<{
      model: string;
      reasoning: string;
      sessionId: string;
    }> = [];
    const sample = () => {
      const output =
        spawnSync("ps", ["-Aww", "-o", "command="], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        }).stdout ?? "";
      for (const line of output.split("\n")) {
        if (
          !line.includes("codex-app-server-driver.mjs") ||
          !line.includes(sessionId)
        )
          continue;
        const model = /--model\s+(\S+)/u.exec(line)?.[1];
        const reasoning = /--reasoning\s+(\S+)/u.exec(line)?.[1];
        if (model && reasoning) samples.push({ model, reasoning, sessionId });
      }
    };
    const evidence: Record<string, unknown> = {
      sessionId,
      revisionId,
      steps: [],
      startedAt: new Date().toISOString(),
    };
    const steps = evidence.steps as Array<Record<string, unknown>>;
    const wait = async (predicate: () => boolean, timeout = 240_000) => {
      const deadline = Date.now() + timeout;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, "Codex continuity gate timed out");
        sample();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    };
    const post = async <T>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(`${app.clientOrigin()}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${prepared.humanAccessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value as T;
    };
    const head = (roomId: string) =>
      observer.sync(actor, { roomId, consumerId: "codex-target-gate" })
        .latestRoomSeq;
    try {
      await wait(
        () => app.health().state === "online" && !!app.clientOrigin(),
        60_000,
      );
      assert.deepEqual(app.health().participantIds, [participantId]);
      const inventory = await post<LocalRuntimeInventoryResponse>(
        "/v1/local/runtimes/list",
        {},
      );
      const runtime = inventory.runtimes.find(
        (item) => item.runtimeProfileId === specs[2]!.runtimeProfileId,
      );
      assert.ok(
        runtime?.modelBindingDescriptors.some(
          (binding) =>
            binding.modelId === "gpt-5.6-luna" &&
            binding.supportedReasoning.includes("low"),
        ),
      );
      const roomA = prepared.metadata.defaultRoomId;
      const roomB = String(
        db
          .prepare("SELECT room_id FROM rooms WHERE slug='core-chain-room-b'")
          .get()?.room_id,
      );
      assert.ok(roomB.startsWith("room_"));
      const opened = await post<{ room: { roomId: string } }>(
        "/v3/client/rooms/direct/open",
        {
          basedOnControlRoomSeq: head(prepared.metadata.controlRoomId),
          idempotencyKey: "codex-target-continuity-dm",
          peerPrincipalId: participantId,
          workspaceId: prepared.metadata.workspaceId,
        },
      );
      const nonce = Date.now().toString(36);
      const plan = [
        {
          name: "B",
          roomId: roomB,
          body: `@steady-c 请查看当前对话，回复且仅回复 [TARGET-B-${nonce}]。不用创建任务。`,
          expected: `[TARGET-B-${nonce}]`,
        },
        {
          name: "A-original-audit",
          roomId: roomA,
          body: "@steady-c [CCG-9] 请独立地把 acceptance/S4-audit.txt 写成一行 S4 AUDIT OK，然后只回复 S4 AUDIT DONE。",
          expected: "S4 AUDIT DONE",
        },
        {
          name: "DM",
          roomId: opened.room.roomId,
          body: `请回复且仅回复 [TARGET-DM-${nonce}]。不用创建任务。`,
          expected: `[TARGET-DM-${nonce}]`,
        },
        {
          name: "A-return",
          roomId: roomA,
          body: `@steady-c 请回复且仅回复 [TARGET-A-RETURN-${nonce}]。不用创建任务。`,
          expected: `[TARGET-A-RETURN-${nonce}]`,
        },
      ];
      const initialMessageRowid = Number(
        db.prepare("SELECT coalesce(max(rowid),0) n FROM messages").get()?.n,
      );
      for (const step of plan) {
        await wait(() => !busy());
        const rowid = Number(
          db.prepare("SELECT coalesce(max(rowid),0) n FROM messages").get()?.n,
        );
        const runRowid = Number(
          db.prepare("SELECT coalesce(max(rowid),0) n FROM run_attempts").get()
            ?.n,
        );
        const sampleFloor = samples.length;
        const startedAt = Date.now();
        const request = await post<{ event: { aggregateId: string } }>(
          "/v3/client/messages/post",
          {
            roomId: step.roomId,
            body: step.body,
            basedOnRoomSeq: head(step.roomId),
            idempotencyKey: `codex-target-${nonce}-${step.name}`,
            recipients: [{ participantId, reason: "mention" }],
          },
        );
        const replies = () =>
          db
            .prepare(
              "SELECT message_id,room_id,thread_id,body,created_at FROM messages WHERE rowid>? AND actor_id=? ORDER BY rowid",
            )
            .all(rowid, participantId);
        await wait(() => {
          for (const reply of replies())
            assert.equal(
              reply.room_id,
              step.roomId,
              `CROSSTALK ${step.name}: ${JSON.stringify(reply)}`,
            );
          return replies().length > 0 && !busy();
        });
        const rows = replies();
        assert.equal(rows.length, 1, JSON.stringify(rows));
        assert.equal(rows[0]!.body, step.expected);
        assert.equal(rows[0]!.thread_id, null);
        assert.equal(sessions().length, 1);
        assert.equal(
          sessions()[0].providerSessionId,
          sessionId,
          "new Provider session is not a continuity pass",
        );
        assert.ok(
          samples.length > sampleFloor,
          "must observe the actual resumed Codex driver",
        );
        for (const actual of samples.slice(sampleFloor)) {
          assert.equal(actual.model, "gpt-5.6-luna");
          assert.equal(actual.reasoning, "low");
        }
        const runs = db
          .prepare(
            "SELECT r.run_attempt_id,r.state,r.exit_code,a.room_id FROM run_attempts r JOIN activations a ON a.activation_id=r.activation_id WHERE r.rowid>? AND a.participant_id=?",
          )
          .all(runRowid, participantId);
        assert.ok(runs.length > 0);
        if (step.name === "DM")
          assert.equal(
            runs.length,
            1,
            "DM must succeed on the first execution, not via Activation retry",
          );
        for (const run of runs) {
          assert.equal(run.room_id, step.roomId);
          assert.equal(run.state, "exited");
          assert.equal(run.exit_code, 0);
        }
        steps.push({
          name: step.name,
          roomId: step.roomId,
          request: request.event.aggregateId,
          replies: rows,
          runs,
          durationMs: Date.now() - startedAt,
          actual: samples.at(-1),
        });
        console.log(`CODEX_TARGET_STEP ${JSON.stringify(steps.at(-1))}`);
        if (step.name === "A-original-audit")
          assert.equal(
            readFileSync(
              join(workspace, "acceptance/S4-audit.txt"),
              "utf8",
            ).trim(),
            "S4 AUDIT OK",
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      assert.equal(busy(), false);
      const finalReplies = db
        .prepare(
          "SELECT room_id,thread_id,body FROM messages WHERE rowid>? AND actor_id=? ORDER BY rowid",
        )
        .all(initialMessageRowid, participantId);
      assertFinalTargetReplies(finalReplies, plan);
      assert.equal(sessions().length, 1);
      assert.equal(sessions()[0].providerSessionId, sessionId);
      evidence.finalReplies = finalReplies;
      assert.equal(
        Number(
          db
            .prepare(
              "SELECT count(*) n FROM run_attempts WHERE rowid>? AND participant_id<>?",
            )
            .get(baselineRunRowid, participantId)?.n,
        ),
        0,
        "unrelated Agents must not execute in this gate",
      );
      assert.equal(
        observer
          .listAgentCatalog(actor, {
            controlRoomId: prepared.metadata.controlRoomId,
          })
          .find((entry) => entry.definition.participantId === participantId)
          ?.definition.currentRevisionId,
        revisionId,
      );
      evidence.outcome = "passed";
    } catch (error) {
      evidence.outcome = "failed";
      evidence.error = String(error);
      throw error;
    } finally {
      evidence.finishedAt = new Date().toISOString();
      writeFileSync(
        join(directory, "codex-target-continuity-evidence.json"),
        JSON.stringify(evidence, null, 2),
      );
      abort.abort();
      await running;
      rmSync(gateSecret, { force: true });
      observer.close();
      db.close();
    }
  },
);

function assertFinalTargetReplies(
  replies: Array<{ room_id?: unknown; thread_id?: unknown; body?: unknown }>,
  expected: Array<{ roomId: string; expected: string }>,
): void {
  assert.equal(
    replies.length,
    expected.length,
    "late or duplicate Agent replies",
  );
  for (const [index, reply] of replies.entries()) {
    assert.equal(
      reply.room_id,
      expected[index]!.roomId,
      "late target crosstalk",
    );
    assert.equal(reply.body, expected[index]!.expected);
    assert.equal(reply.thread_id, null);
  }
}

test("final target evidence rejects delayed wrong-room, duplicate and threaded replies", () => {
  const expected = [{ roomId: "room-a", expected: "OK" }];
  const good = [{ room_id: "room-a", thread_id: null, body: "OK" }];
  assertFinalTargetReplies(good, expected);
  assert.throws(() => assertFinalTargetReplies([...good, ...good], expected));
  assert.throws(() =>
    assertFinalTargetReplies([{ ...good[0], room_id: "room-b" }], expected),
  );
  assert.throws(() =>
    assertFinalTargetReplies([{ ...good[0], thread_id: "thread-a" }], expected),
  );
});
