import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentMemoryWorkspacePath } from "../src/agent-memory-workspace.ts";
import { runWorkerCliCommand } from "../src/worker-cli.ts";

for (const failure of ["none", "wrong-owner", "output"])
  test(`startup check returns original memory and bounded delivery in one call (${failure})`, async () => {
    const root = mkdtempSync(join(tmpdir(), "rah-startup-check-"));
    chmodSync(root, 0o700);
    try {
      const memory = agentMemoryWorkspacePath(root, "agent-1");
      mkdirSync(memory, { mode: 0o700 });
      const original =
        "\uFEFF# Original memory\r\n" + "Keep this exact index.\n".repeat(300);
      writeFileSync(join(memory, "MEMORY.md"), original, { mode: 0o600 });
      const credential = join(root, "credential");
      writeFileSync(credential, "private-token", { mode: 0o600 });
      const requests: string[] = [];
      let output = "";
      let error = "";
      const code = await runWorkerCliCommand(
        ["worker", "message-check", "--startup"],
        {
          env: {
            RAH_WORKER_API_URL: "http://127.0.0.1:43123",
            RAH_WORKER_SESSION_FILE: credential,
            RAH_PARTICIPANT_ID:
              failure === "wrong-owner" ? "agent-2" : "agent-1",
            RAH_AGENT_MEMORY_DIR: memory,
            RAH_AGENT_MEMORY_INDEX: join(memory, "MEMORY.md"),
            RAH_ROOM_ID: "room-1",
            RAH_FROM_SEQ: "5",
            RAH_TO_SEQ: "7",
            UNRELATED_SECRET: "must-not-appear",
          },
          fetch: async (url) => {
            requests.push(new URL(url).pathname);
            return new Response(
              JSON.stringify(
                url.endsWith("message-check")
                  ? {
                      throughSeq: 7,
                      delivery: {
                        cursorBefore: 4,
                        cursorAfter: 7,
                        latestRoomSeq: 20,
                        events: [],
                        snapshot: null,
                      },
                    }
                  : { acknowledgedThrough: 7 },
              ),
            );
          },
          stdout: {
            write(text) {
              if (failure === "output") throw new Error("EPIPE");
              output += text;
            },
          },
          stderr: {
            write(text) {
              error += text;
            },
          },
        },
      );
      if (failure === "none") {
        assert.equal(code, 0, error);
        assert.ok(
          output.includes(original),
          "the complete original index is returned without normalization or truncation",
        );
        assert.match(output, /room-1/);
        assert.deepEqual(requests, [
          "/v1/worker/message-check",
          "/v1/worker/acknowledge",
        ]);
        assert.doesNotMatch(output, /private-token|must-not-appear/);
      } else {
        assert.notEqual(code, 0);
        assert.match(error, failure === "output" ? /EPIPE/ : /memory.*owner/i);
        assert.deepEqual(
          requests,
          [],
          "a failed startup read/output cannot acknowledge any delivery",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

test("startup keeps actionable scope but excludes manifest placement bookkeeping", async () => {
  const { workerStartupContext } =
    await import("../src/worker-startup-context.ts");
  const result = await workerStartupContext({
    RAH_ROOM_ID: "room-1",
    RAH_FROM_SEQ: "4",
    RAH_TO_SEQ: "8",
    RAH_CONTEXT_MANIFEST_JSON: JSON.stringify({
      schemaVersion: 1,
      activationId: "activation-1",
      participantId: "agent-1",
      roomId: "room-1",
      runAttemptId: "run-technical",
      contextManifestId: "manifest-technical",
      contentDigest: "sha256:" + "a".repeat(64),
      createdAt: "2026-09-21T00:00:00Z",
      eventRanges: [{ fromSeq: 4, toSeq: 8 }],
      throughRoomSeq: 8,
    }),
  });
  assert.match(result, /room-1/);
  assert.match(result, /4/);
  assert.match(result, /8/);
  assert.doesNotMatch(
    result,
    /manifest-technical|run-technical|contentDigest|eventRanges/,
  );
});

test("startup does not append an unchanged system-delivered index, but returns the full index after a change", async () => {
  const { createHash } = await import("node:crypto");
  const { workerStartupContext } =
    await import("../src/worker-startup-context.ts");
  const root = mkdtempSync(join(tmpdir(), "rah-system-startup-"));
  chmodSync(root, 0o700);
  const directory = agentMemoryWorkspacePath(root, "agent-1");
  mkdirSync(directory, { mode: 0o700 });
  const original = "\uFEFF# Whole original\r\nA memory fact\n";
  writeFileSync(join(directory, "MEMORY.md"), original, { mode: 0o600 });
  const env = {
    RAH_PARTICIPANT_ID: "agent-1",
    RAH_AGENT_MEMORY_DIR: directory,
    RAH_AGENT_MEMORY_INDEX: join(directory, "MEMORY.md"),
    RAH_AGENT_MEMORY_SYSTEM_SHA256: createHash("sha256")
      .update(original)
      .digest("hex"),
  };
  try {
    const result = await workerStartupContext(env);
    assert.ok(
      !result.includes(original),
      "do not accumulate another copy in tool history",
    );
    assert.match(result, /complete original MEMORY.md.*system prompt/i);
    const changed = original + "New correction\n";
    writeFileSync(join(directory, "MEMORY.md"), changed, { mode: 0o600 });
    assert.ok((await workerStartupContext(env)).includes(changed));
    assert.ok(
      (
        await workerStartupContext({
          ...env,
          RAH_AGENT_MEMORY_SYSTEM_SHA256: undefined,
        })
      ).includes(changed),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
