import { prepareLocalWorkbench } from "./workbench-channel-fixture.ts";
import { RuntimeGuideSettings } from "../src/runtime-guide-settings.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { GenericProcessAdapter } from "@rah-os/agent-host";
import { agentExecutionWorkspacePath } from "../../agent-host/src/agent-execution-workspace.ts";
import { RoomKernel } from "@rah-os/kernel";
import type {
  AgentCatalogEntry,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import {
  DaemonApplication,
  localCliRuntimeSpec,
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
    cli: "claude",
    model: "sonnet",
    effort: "low",
    provider: "claude-stream-json/v1",
    driver: "claude-stream-json-driver.mjs",
    effortFlag: "effort",
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

const scenario = "native-busy";

const selectedCli = process.env.RAH_REAL_NATIVE_BUSY_CLI ?? "codex";
assert.ok(
  selectedCli === undefined || cases.some((row) => row.cli === selectedCli),
);

// Use isolated identities. Claude first needs a completed turn: an announced
// fresh session id is not yet eligible for native busy delivery in Raft either.
for (const binding of cases.filter(
  (row) => selectedCli === undefined || row.cli === selectedCli,
))
  test(
    `opt-in ${binding.cli} ${scenario} delivers an append before original run exits`,
    {
      skip: process.env.RAH_REAL_NATIVE_BUSY_GATE !== "1",
      timeout: 15 * 60_000,
    },
    async () => {
      const directory = mkdtempSync(
        join(tmpdir(), `rah-native-busy-${binding.cli}-`),
      );
      const stateDirectory = join(directory, "state"),
        workspace = join(directory, "workspace");
      mkdirSync(join(workspace, "acceptance"), {
        recursive: true,
        mode: 0o700,
      });
      console.log(`NATIVE_BUSY_STATE ${binding.cli} ${directory}`);
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
      assert.equal(
        new RuntimeGuideSettings(
          join(stateDirectory, "runtime-guide.json"),
        ).enabled(binding.cli === "codex" ? "codex" : "claude"),
        true,
      );
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
      const originalNotify = GenericProcessAdapter.prototype.notifyBusy;
      const nativeNotices: { at: string; accepted: boolean; runId: string }[] =
        [];
      GenericProcessAdapter.prototype.notifyBusy = async function (...args) {
        const accepted = await originalNotify.apply(this, args);
        nativeNotices.push({
          at: new Date().toISOString(),
          accepted,
          runId: args[0].runId,
        });
        return accepted;
      };
      evidence.nativeNotices = nativeNotices;
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
          agentId: agent.definition.agentId,
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
        const postMessage = (body: string, idempotencyKey: string) =>
          k.postMessage(actor, {
            roomId: roomA,
            body,
            idempotencyKey,
            recipients: [{ participantId, reason: "mention" }],
          });
        if (binding.cli === "claude") {
          postMessage(
            `@${handle} 本轮仅为通信验收。请在当前频道只回复 [READY]，不创建Task，不使用Thread，不修改记忆，然后结束本轮。`,
            "busy-warmup",
          );
          await wait(() =>
            Boolean(
              db
                .prepare(
                  "SELECT 1 FROM messages WHERE actor_id=? AND body='[READY]'",
                )
                .get(participantId),
            ),
          );
          await wait(
            () =>
              !db
                .prepare(
                  "SELECT 1 FROM activations WHERE state IN ('queued','leased','quarantined') LIMIT 1",
                )
                .get(),
          );
        }
        const baselineRunIds = new Set(
          db
            .prepare("SELECT run_attempt_id FROM run_attempts")
            .all()
            .map((row) => row.run_attempt_id),
        );
        const started = Date.now();
        postMessage(
          `@${handle} 本轮仅为通信验收，不创建Task，不使用Thread。先执行 touch '${join(workspace, "acceptance/busy-started")}'; sleep 30，然后在当前频道回复 [ORIGINAL:DONE]。执行期间可能有另一条Human消息，请保留原请求并分别处理。`,
          "busy-original",
        );
        await wait(() =>
          existsSync(join(workspace, "acceptance/busy-started")),
        );
        const run = db
          .prepare(
            "SELECT run_attempt_id,runtime_run_id FROM run_attempts WHERE state='running' ORDER BY rowid DESC LIMIT 1",
          )
          .get();
        assert.ok(run);
        evidence.originalRun = run.run_attempt_id;
        evidence.appendAtMs = Date.now() - started;
        postMessage(
          `@${handle} 追加通信验收：请在当前频道另外回复 [APPEND:DONE]。原请求 [ORIGINAL:DONE] 仍需完成，不替代、不取消它。不创建Task，不使用Thread。`,
          "busy-append",
        );
        const replies = () =>
          db
            .prepare(
              "SELECT message_id,room_id,thread_id,body,created_at FROM messages WHERE actor_id=? ORDER BY rowid",
            )
            .all(participantId);
        await wait(
          () =>
            replies().some((r) => String(r.body).includes("[ORIGINAL:DONE]")) &&
            replies().some((r) => String(r.body).includes("[APPEND:DONE]")),
          240000,
        );
        evidence.repliesAtMs = Date.now() - started;
        evidence.replies = replies();
        const runs = db
          .prepare(
            "SELECT run_attempt_id,state FROM run_attempts ORDER BY rowid",
          )
          .all()
          .filter((row) => !baselineRunIds.has(row.run_attempt_id));
        evidence.runsAtReplies = runs;
        assert.equal(
          runs.length,
          1,
          "append must be handled in original run, not after a new Activation",
        );
        assert.ok(
          evidence.samples.length > 0,
          "actual provider model and effort must be observed",
        );
        await wait(
          () =>
            !db
              .prepare(
                "SELECT 1 FROM activations WHERE state IN ('queued','leased','quarantined') LIMIT 1",
              )
              .get(),
          120000,
        );
        assert.ok(
          nativeNotices.some(
            (notice) => notice.accepted && notice.runId === run.runtime_run_id,
          ),
          "native transport must accept a busy notification, not merely spontaneous message checking",
        );
        for (const marker of ["[ORIGINAL:DONE]", "[APPEND:DONE]"]) {
          assert.equal(
            replies().filter((reply) => reply.body === marker).length,
            1,
          );
        }
        if (binding.cli === "claude") {
          const runtimeCwd = agentExecutionWorkspacePath(
            join(stateDirectory, "agent-workspaces"),
            participantId,
          );
          const project = join(
            homedir(),
            ".claude",
            "projects",
            realpathSync(runtimeCwd).replace(/[^a-zA-Z0-9]/gu, "-"),
          );
          const notices = readdirSync(project)
            .filter((name) => name.endsWith(".jsonl"))
            .flatMap((name) =>
              readFileSync(join(project, name), "utf8")
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
            )
            .filter(
              (entry) =>
                entry.type === "attachment" &&
                entry.attachment?.type === "queued_command" &&
                entry.attachment.prompt?.some(
                  (block: any) =>
                    block.type === "text" &&
                    block.text.includes("[RAH inbox notice:"),
                ),
            )
            .map((entry) => ({
              timestamp: entry.timestamp,
              type: entry.attachment.type,
            }));
          evidence.nativeProviderInputs = notices;
          assert.equal(
            notices.length,
            1,
            "Claude must record one actual native queued input",
          );
        }
        evidence.outcome = "passed";
      } catch (error) {
        evidence.outcome = "failed";
        evidence.error = String(error);
        throw error;
      } finally {
        evidence.finishedAt = new Date().toISOString();
        evidence.finalRuns = db
          .prepare(
            "SELECT run_attempt_id,activation_id,state,started_at,finished_at FROM run_attempts ORDER BY rowid",
          )
          .all();
        writeFileSync(
          join(directory, "evidence.json"),
          JSON.stringify(evidence, null, 2),
        );
        GenericProcessAdapter.prototype.notifyBusy = originalNotify;
        abort.abort();
        await running;
        k.close();
        db.close();
      }
    },
  );
