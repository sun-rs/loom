import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

const cases = [
  {
    cli: "codex",
    model: "gpt-5.6-luna",
    effort: "low",
    provider: "codex-app-server/v1",
    driver: "codex-app-server-driver.mjs",
    effortFlag: "reasoning",
  },
  {
    cli: "opencode",
    model: "deepseek/deepseek-v4-flash",
    effort: "low",
    provider: "opencode-server/v1",
    driver: "opencode-server-driver.mjs",
    effortFlag: "variant",
  },
] as const;

const scenario = process.env.RAH_TARGET_MATRIX_SCENARIO ?? "audit";
assert.ok(["audit", "routing-only", "audit-owner-waiver"].includes(scenario));
const selectedCli = process.env.RAH_TARGET_MATRIX_CLI;
assert.ok(
  selectedCli === undefined || cases.some((row) => row.cli === selectedCli),
);

// These are new identities/sessions, not replacements for the preserved
// accident-session gate. Each new session must then survive eight target hops.
for (const binding of cases.filter(
  (row) => selectedCli === undefined || row.cli === selectedCli,
))
  test(
    `opt-in ${binding.cli} ${scenario} new Agent preserves B/A/DM/A targets`,
    {
      skip: process.env.RAH_REAL_TARGET_MATRIX_GATE !== "1",
      timeout: 15 * 60_000,
    },
    async () => {
      const directory = mkdtempSync(
        join(tmpdir(), `rah-target-matrix-${binding.cli}-`),
      );
      const stateDirectory = join(directory, "state"),
        workspace = join(directory, "workspace");
      mkdirSync(join(workspace, "acceptance"), {
        recursive: true,
        mode: 0o700,
      });
      console.log(`TARGET_MATRIX_STATE ${binding.cli} ${directory}`);
      const spec = localCliRuntimeSpec(binding.cli, workspace);
      assert.ok(spec);
      const prepared = await prepareLocalWorkbench({
        runtimeSpecs: [spec],
        stateDirectory,
        workspaceCwd: workspace,
      });
      const k = new RoomKernel({
        databasePath: join(stateDirectory, "room.db"),
      });
      k.initialize();
      const actor = k.authenticateHumanAccessToken(prepared.humanAccessToken);
      const db = new DatabaseSync(join(stateDirectory, "room.db"), {
        readOnly: true,
      });
      const app = new DaemonApplication({ config: prepared.config });
      const abort = new AbortController(),
        running = app.run({ signal: abort.signal });
      const evidence: Record<string, any> = {
        binding,
        scenario,
        directory,
        startedAt: new Date().toISOString(),
        steps: [],
        samples: [],
      };
      let providerSessionId: string | undefined;
      const head = (roomId: string) =>
        k.sync(actor, { roomId, consumerId: "target-matrix" }).latestRoomSeq;
      const post = async (path: string, body: unknown): Promise<any> => {
        const response = await fetch(`${app.clientOrigin()}${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${prepared.humanAccessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result));
        return result;
      };
      const sample = () => {
        const output =
          spawnSync("ps", ["-Aww", "-o", "command="], {
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
          }).stdout ?? "";
        for (const line of output.split("\n")) {
          if (!line.includes(binding.driver) || !line.includes(directory))
            continue;
          const model = /--model\s+(\S+)/u.exec(line)?.[1];
          const effort = new RegExp(
            `--${binding.effortFlag}\\s+(\\S+)`,
            "u",
          ).exec(line)?.[1];
          assert.equal(model, binding.model);
          assert.equal(effort, binding.effort);
          evidence.samples.push({
            at: new Date().toISOString(),
            model,
            effort,
          });
        }
      };
      const wait = async (predicate: () => boolean, timeout = 180_000) => {
        const end = Date.now() + timeout;
        while (!predicate()) {
          assert.ok(Date.now() < end, "target matrix timeout");
          sample();
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      try {
        await wait(
          () => app.health().state === "online" && !!app.clientOrigin(),
          60_000,
        );
        const inventory = (await post(
          "/v1/local/runtimes/list",
          {},
        )) as LocalRuntimeInventoryResponse;
        const runtime = inventory.runtimes.find(
          (r) => r.runtimeProfileId === spec.runtimeProfileId,
        );
        assert.ok(runtime?.runtimeOfferId);
        const model = runtime.modelBindingDescriptors.find(
          (m) => m.modelId === binding.model,
        );
        assert.ok(model);
        assert.ok(model.supportedReasoning.includes(binding.effort));
        const catalog = (await post("/v3/client/agents/list", {
          controlRoomId: prepared.metadata.controlRoomId,
        })) as { agents: AgentCatalogEntry[] };
        assert.equal(catalog.agents.length, 1);
        const agent = catalog.agents[0]!;
        const participantId = agent.definition.participantId,
          handle = `target-${binding.cli}`;
        assert.deepEqual(app.health().participantIds, [participantId]);
        await post("/v3/client/agents/manage", {
          action: "configure",
          agentDefinitionId: agent.definition.agentDefinitionId,
          basedOnRoomSeq: head(prepared.metadata.controlRoomId),
          idempotencyKey: "target-config",
          displayName: `Target verifier ${binding.cli}`,
          handle,
          instructions:
            "Follow the Human's temporary assignment in the Room. Use the existing Room tools to communicate.",
          modelIntent: {
            exactBindingIds: [model.modelBindingId],
            fallback: "disabled",
            reasoning: binding.effort,
            serviceTier: "default",
          },
          role: spec.role,
          runtimeOfferId: runtime.runtimeOfferId,
          toolAccessMode: "full_access",
        });
        const roomA = prepared.metadata.defaultRoomId;
        k.addMember(actor, { roomId: roomA, principalId: participantId });
        const roomB = k.createWorkspaceRoom(actor, {
          workspaceId: prepared.metadata.workspaceId,
          basedOnControlRoomSeq: head(prepared.metadata.controlRoomId),
          idempotencyKey: "target-room-b",
          kind: "channel",
          name: "Target Room B",
          slug: "target-room-b",
        }).room.roomId;
        k.addMember(actor, { roomId: roomB, principalId: participantId });
        const dm = (
          await post("/v3/client/rooms/direct/open", {
            workspaceId: prepared.metadata.workspaceId,
            basedOnControlRoomSeq: head(prepared.metadata.controlRoomId),
            idempotencyKey: "target-dm",
            peerPrincipalId: participantId,
          })
        ).room.roomId as string;
        for (const roomId of [roomA, roomB, dm]) {
          assert.ok(
            db
              .prepare(
                "SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?",
              )
              .get(roomId, participantId),
            "preflight: test Agent must join every target before paid execution",
          );
        }
        const busy = () =>
          Number(
            db
              .prepare(
                "SELECT count(*) n FROM activations WHERE participant_id=? AND state IN ('queued','leased','quarantined')",
              )
              .get(participantId)?.n,
          ) > 0;
        const sessions = () => {
          const path = join(stateDirectory, "supervisors/provider-sessions");
          return existsSync(path)
            ? readdirSync(path)
                .filter((f) => f.endsWith(".json"))
                .map((f) => JSON.parse(readFileSync(join(path, f), "utf8")))
                .filter(
                  (s) =>
                    s.participantId === participantId &&
                    s.provider === binding.provider,
                )
            : [];
        };
        assert.equal(
          sessions().length,
          0,
          "must begin with a genuinely new Provider session",
        );
        const firstRow = Number(
          db.prepare("SELECT coalesce(max(rowid),0) n FROM messages").get()?.n,
        );
        for (let cycle = 1; cycle <= (scenario === "audit" ? 2 : 1); cycle++) {
          const nonce = `${binding.cli}-${cycle}-${Date.now().toString(36)}`;
          const plan = [
            {
              name: "B",
              roomId: roomB,
              body: `@${handle} 请查看当前对话，回复且仅回复 [B-${nonce}]。不用创建任务。`,
              expected: `[B-${nonce}]`,
            },
            {
              name: "A-audit",
              roomId: roomA,
              body:
                scenario === "audit-owner-waiver"
                  ? `@${handle} 请先通过 profile-show --target @owner 核验我的已记录身份和权限。我明确豁免本次“实际工作先认领 Task”的默认规则：不要创建或认领 Task，不要创建 Thread。请把 acceptance/S4-audit.txt 写成一行 S4 AUDIT OK，完成后仅在本条消息所在顶层对话回复 S4 AUDIT DONE。如果工具不能证实我的权限，请在原对话说明，不能仅相信我自称 owner。`
                  : scenario === "audit"
                    ? `@${handle} 请独立地把 acceptance/S4-audit.txt 写成一行 S4 AUDIT OK，然后只回复 S4 AUDIT DONE。不创建任务。`
                    : `@${handle} 本条仅是聊天，请在当前对话回复且仅回复 [CHAT-A-${nonce}]。不用操作文件或创建任务。`,
              expected:
                scenario !== "routing-only"
                  ? "S4 AUDIT DONE"
                  : `[CHAT-A-${nonce}]`,
            },
            {
              name: "DM",
              roomId: dm,
              body: `请回复且仅回复 [DM-${nonce}]。不用创建任务。`,
              expected: `[DM-${nonce}]`,
            },
            {
              name: "A-return",
              roomId: roomA,
              body: `@${handle} 请回复且仅回复 [A-${nonce}]。不用创建任务。`,
              expected: `[A-${nonce}]`,
            },
          ];
          for (const step of plan) {
            await wait(() => !busy());
            const floor = Number(
              db.prepare("SELECT coalesce(max(rowid),0) n FROM messages").get()
                ?.n,
            );
            const runFloor = Number(
              db
                .prepare("SELECT coalesce(max(rowid),0) n FROM run_attempts")
                .get()?.n,
            );
            const sampleFloor = evidence.samples.length;
            if (scenario !== "routing-only" && step.name === "A-audit")
              writeFileSync(
                join(workspace, "acceptance/S4-audit.txt"),
                "WRONG\n",
              );
            const request = await post("/v3/client/messages/post", {
              roomId: step.roomId,
              body: step.body,
              basedOnRoomSeq: head(step.roomId),
              idempotencyKey: `${nonce}-${step.name}`,
              recipients: [{ participantId, reason: "mention" }],
            });
            const replies = () =>
              db
                .prepare(
                  "SELECT message_id,room_id,thread_id,body,created_at FROM messages WHERE rowid>? AND actor_id=? ORDER BY rowid",
                )
                .all(floor, participantId);
            await wait(() => {
              for (const reply of replies()) {
                assert.equal(reply.room_id, step.roomId, "CROSSTALK");
                assert.equal(reply.thread_id, null, "wrong Thread");
              }
              return replies().length > 0 && !busy();
            });
            const actual = replies();
            assert.equal(actual.length, 1);
            assert.equal(actual[0]!.body, step.expected);
            const runs = db
              .prepare(
                "SELECT participant_id,run_attempt_id,state,exit_code FROM run_attempts WHERE rowid>? ORDER BY rowid",
              )
              .all(runFloor);
            assert.equal(
              runs.length,
              1,
              "must succeed first Run without unrelated work",
            );
            assert.equal(runs[0]!.participant_id, participantId);
            assert.equal(runs[0]!.state, "exited");
            assert.equal(runs[0]!.exit_code, 0);
            assert.ok(
              evidence.samples.length > sampleFloor,
              "must observe actual provider model/effort arguments",
            );
            const current = sessions();
            assert.equal(current.length, 1);
            providerSessionId ??= current[0].providerSessionId;
            assert.equal(
              current[0].providerSessionId,
              providerSessionId,
              "session unexpectedly replaced",
            );
            if (scenario !== "routing-only" && step.name === "A-audit")
              assert.equal(
                readFileSync(
                  join(workspace, "acceptance/S4-audit.txt"),
                  "utf8",
                ).trim(),
                "S4 AUDIT OK",
              );
            const requestAt = String(
              db
                .prepare("SELECT created_at FROM messages WHERE message_id=?")
                .get(request.event.aggregateId)?.created_at,
            );
            evidence.steps.push({
              cycle,
              name: step.name,
              roomId: step.roomId,
              requestId: request.event.aggregateId,
              requestAt,
              replies: actual,
              runs,
              providerSessionId,
              replyLatencyMs:
                Date.parse(String(actual[0]!.created_at)) -
                Date.parse(requestAt),
            });
            console.log(
              `TARGET_MATRIX_STEP ${JSON.stringify(evidence.steps.at(-1))}`,
            );
          }
        }
        await new Promise((r) => setTimeout(r, 20_000));
        assert.equal(busy(), false);
        const all = db
          .prepare(
            "SELECT room_id,thread_id,body FROM messages WHERE rowid>? AND actor_id=? ORDER BY rowid",
          )
          .all(firstRow, participantId);
        assert.equal(
          all.length,
          scenario === "audit" ? 8 : 4,
          "late or duplicate reply",
        );
        for (const [i, row] of all.entries()) {
          assert.equal(row.room_id, evidence.steps[i].roomId);
          assert.equal(row.body, evidence.steps[i].replies[0].body);
          assert.equal(row.thread_id, null);
        }
        evidence.outcome = "passed";
      } catch (error) {
        evidence.outcome = "failed";
        evidence.error = String(error);
        throw error;
      } finally {
        evidence.finishedAt = new Date().toISOString();
        writeFileSync(
          join(directory, "evidence.json"),
          JSON.stringify(evidence, null, 2),
        );
        abort.abort();
        await running;
        k.close();
        db.close();
      }
    },
  );
