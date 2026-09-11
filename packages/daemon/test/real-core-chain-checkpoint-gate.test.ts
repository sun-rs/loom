import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { agentMemoryWorkspacePath } from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import {
  DaemonApplication,
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../src/index.ts";

// Explicit continuation only: the original gate FAILED at a contaminated
// negative control. No old Human messages or configuration mutations replay.
test(
  "opt-in checkpoint: correction survives actual provider reset across Room and DM",
  { skip: process.env.RAH_CORE_CHECKPOINT_GATE !== "1", timeout: 20 * 60_000 },
  async () => {
    const directory = process.env.RAH_CORE_CHECKPOINT_DIRECTORY;
    assert.ok(directory);
    assert.ok(directory.includes("rah-core-chain-"));
    const stateDirectory = join(directory, "state"),
      databasePath = join(stateDirectory, "room.db");
    const db = new DatabaseSync(databasePath, { readOnly: true });
    const revisions = () =>
      db
        .prepare(
          "SELECT agent_definition_id,current_revision_id FROM agent_definitions ORDER BY agent_definition_id",
        )
        .all();
    const beforeRevisions = revisions();
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM activations WHERE state IN ('queued','leased')",
        )
        .get()?.n,
      0,
    );
    const runtimeSpecs = ["kimi", "opencode", "codex"].map((executable) => {
      const spec = localCliRuntimeSpec(
        executable,
        join(directory, "workspace"),
      );
      assert.ok(spec);
      return spec;
    });
    const prepared = await prepareLocalWorkbench({
      runtimeSpecs,
      stateDirectory,
      workspaceCwd: join(directory, "workspace"),
    });
    assert.deepEqual(
      revisions(),
      beforeRevisions,
      "bootstrap must not alter existing roles or policy revisions",
    );
    const observer = new RoomKernel({ databasePath });
    observer.initialize();
    const actor = observer.authenticateHumanAccessToken(
      prepared.humanAccessToken,
    );
    const catalog = observer.listAgentCatalog(actor, {
      controlRoomId: prepared.metadata.controlRoomId,
    });
    const expected = [
      ["mem-a", "kimi", "kimi-code/k3", "high"],
      ["mem-b", "opencode", "deepseek/deepseek-v4-flash", "low"],
      ["steady-c", "codex", "gpt-5.6-luna", "low"],
    ];
    const principal = (handle: string) => {
      const p = db
        .prepare("SELECT principal_id FROM principals WHERE handle=?")
        .get(handle);
      assert.ok(p);
      return String(p.principal_id);
    };
    for (const [handle, cli, model, effort] of expected) {
      const entry = catalog.find(
        (e) => e.definition.participantId === principal(handle!),
      );
      assert.ok(entry);
      const policy = observer.getExecutionPolicyRevision(
        entry.currentRevision.executionPolicyRevisionId,
      );
      assert.deepEqual(policy.modelIntent.exactBindingIds, [
        `local:${cli}-cli/v1:${model}`,
      ]);
      assert.equal(policy.modelIntent.reasoning, effort);
    }
    const memA = principal("mem-a"),
      entry = catalog.find((e) => e.definition.participantId === memA)!;
    const roomA = prepared.metadata.defaultRoomId;
    const roomB = String(
      db
        .prepare("SELECT room_id FROM rooms WHERE slug='core-chain-room-b'")
        .get()?.room_id,
    );
    const dm = String(
      db.prepare("SELECT room_id FROM rooms WHERE kind='direct'").get()
        ?.room_id,
    );
    assert.ok(roomB.startsWith("room_") && dm.startsWith("room_"));
    const memory = agentMemoryWorkspacePath(
      join(stateDirectory, "supervisors", "agent-memory"),
      memA,
    );
    const sessions = join(stateDirectory, "supervisors", "provider-sessions");
    const shutdown = new AbortController();
    const app = new DaemonApplication({ config: prepared.config });
    const running = app.run({ signal: shutdown.signal });
    const evidence: Record<string, unknown> = {
      originalOutcome: "failed polluted negative control",
      checkpoint: "before CCG7",
      directory,
    };
    try {
      await waitUntil(
        () => app.health().state === "online" && !!app.clientOrigin(),
        60_000,
      );
      const origin = app.clientOrigin()!;
      const token = prepared.humanAccessToken;
      console.log(
        "CHECKPOINT_DAEMON",
        JSON.stringify({ pid: process.pid, origin, directory }),
      );
      const inventory = await postJson<LocalRuntimeInventoryResponse>(
        origin,
        token,
        "/v1/local/runtimes/list",
        {},
      );
      for (const [, cli, model, effort] of expected) {
        const spec = runtimeSpecs.find((s) => s.executable === cli)!;
        const rt = inventory.runtimes.find(
          (r) => r.runtimeProfileId === spec.runtimeProfileId,
        );
        const binding = rt?.modelBindingDescriptors.find(
          (b) => b.modelId === model,
        );
        assert.ok(binding?.supportedReasoning.includes(effort!));
      }
      const turn = async (roomId: string, body: string, key: string) => {
        const head = await syncRoom(origin, token, roomId, "checkpoint-human");
        const posted = await postJson<{ event: { roomSeq: number } }>(
          origin,
          token,
          "/v3/client/messages/post",
          {
            roomId,
            body,
            idempotencyKey: key,
            basedOnRoomSeq: head.latestRoomSeq,
            recipients: [
              { participantId: memA, reason: roomId === dm ? "dm" : "mention" },
            ],
          },
        );
        const replies = () =>
          observer
            .listMessages(actor, { roomId, limit: 500 })
            .messages.filter(
              (m) => m.actorId === memA && m.roomSeq > posted.event.roomSeq,
            );
        await waitUntil(
          () =>
            replies().length > 0 &&
            db
              .prepare(
                "SELECT count(*) n FROM activations WHERE state IN ('queued','leased')",
              )
              .get()?.n === 0,
          6 * 60_000,
        );
        const result = replies().map((m) => ({
          messageId: m.messageId,
          body: m.body,
          roomId: m.roomId,
          roomSeq: m.roomSeq,
        }));
        console.log(
          "CHECKPOINT_TURN",
          JSON.stringify({ key, replies: result }),
        );
        return result;
      };
      evidence.correction = await turn(
        roomA,
        "@mem-a [CCG-7] 更正：S5 项目代号从 ORIOLE-1 改为 ORIOLE-2。请更新你的记忆，让旧值不再被当作当前事实。",
        "core-chain-s5-correct",
      );
      assert.ok(
        readMemoryTree(memory).some((f) => f.text.includes("ORIOLE-2")),
      );
      const before = providerSessionIds(sessions, memA),
        files = readMemoryTree(memory);
      assert.ok(before.length);
      const head = await syncRoom(
        origin,
        token,
        prepared.metadata.controlRoomId,
        "checkpoint-reset",
      );
      const receipt = await postJson<{ providerContinuityRecords: number }>(
        origin,
        token,
        "/v3/client/agents/execution/reset",
        {
          agentDefinitionId: entry.definition.agentDefinitionId,
          basedOnRoomSeq: head.latestRoomSeq,
          idempotencyKey: "core-chain-fresh-provider-session",
          mode: "session",
        },
      );
      assert.ok(receipt.providerContinuityRecords > 0);
      assert.deepEqual(readMemoryTree(memory), files);
      assert.deepEqual(providerSessionIds(sessions, memA), []);
      evidence.reset = { before, receipt, filesPreserved: true };
      console.log("CHECKPOINT_RESET", JSON.stringify(evidence.reset));
      const recall = await turn(
        roomB,
        "@mem-a [CCG-8] 请说出 S5 项目代号的当前值，并说明你从哪里读到的。",
        "core-chain-s5-new-session",
      );
      const after = providerSessionIds(sessions, memA);
      assertFreshProviderSessions(before, after);
      assert.ok(recall.some((r) => r.body.includes("ORIOLE-2")));
      evidence.roomB = { recall, after };
      const dmRecall = await turn(
        dm,
        "[CCG-9 checkpoint] 请说出 S5 项目代号的当前值，并说明你从哪里读到的。",
        "core-chain-checkpoint-dm-recall",
      );
      assert.ok(dmRecall.some((r) => r.body.includes("ORIOLE-2")));
      evidence.dm = dmRecall;
      evidence.outcome = "passed";
    } catch (error) {
      evidence.outcome = "failed";
      evidence.error = String(error);
      throw error;
    } finally {
      writeFileSync(
        join(directory, "checkpoint-evidence.json"),
        JSON.stringify(evidence, null, 2),
      );
      shutdown.abort("checkpoint ended");
      await running;
      observer.close();
      db.close();
    }
  },
);
function readMemoryTree(directory: string): { path: string; text: string }[] {
  if (!existsSync(directory)) return [];
  const files: { path: string; text: string }[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        try {
          files.push({ path, text: readFileSync(path, "utf8") });
        } catch {
          // Unreadable memory files are reported by their absence from hits.
        }
      }
    }
  };
  walk(directory);
  return files;
}

async function postJson<T = unknown>(
  origin: string,
  accessToken: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const responseBody = (await response.json()) as T;
  assert.equal(
    response.status,
    200,
    `${path} failed: ${JSON.stringify(responseBody)}`,
  );
  return responseBody;
}

async function syncRoom(
  origin: string,
  accessToken: string,
  roomId: string,
  consumerId: string,
): Promise<{ latestRoomSeq: number }> {
  return await postJson(origin, accessToken, "/v3/client/rooms/sync", {
    consumerId,
    roomId,
  });
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("real core-chain gate timed out");
    await sleep(100);
  }
}

function providerSessionIds(
  directory: string,
  participantId: string,
): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const record = JSON.parse(
        readFileSync(join(directory, name), "utf8"),
      ) as { participantId?: string; providerSessionId?: string };
      return record.participantId === participantId &&
        typeof record.providerSessionId === "string"
        ? [record.providerSessionId]
        : [];
    })
    .sort();
}

function assertFreshProviderSessions(before: string[], after: string[]): void {
  assert.ok(
    before.length > 0 && after.length > 0,
    "both sides need actual provider evidence",
  );
  assert.ok(
    after.every((id) => !before.includes(id)),
    "new RunAttempt must not masquerade as a new provider session",
  );
}
