import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentMemoryWorkspacePath } from "@rah-os/agent-host";
import { startupMemorySystemLease } from "../src/startup-memory-system-lease.ts";

test("system memory transport preserves the complete index without exposing it in argv and releases its private file", async () => {
  const root = mkdtempSync(join(tmpdir(), "rah-system-memory-test-"));
  chmodSync(root, 0o700);
  const directory = agentMemoryWorkspacePath(root, "agent-1");
  mkdirSync(directory, { mode: 0o700 });
  const original = "\uFEFF# Original\r\n" + "Complete memory.\n".repeat(5000);
  writeFileSync(join(directory, "MEMORY.md"), original, { mode: 0o600 });
  try {
    const lease = await startupMemorySystemLease({
      participantId: "agent-1",
      memoryDirectory: directory,
      promptLease: {
        env: {},
        args: ["--prompt", "Standing role"],
        standingPromptDigest: "base-digest",
      },
    });
    const path = lease.args![1]!;
    assert.equal(lease.args![0], "--prompt-file");
    const prompt = readFileSync(path, "utf8");
    assert.ok(prompt.includes(original));
    assert.ok(prompt.includes("Standing role"));
    assert.equal(lease.args!.length, 2);
    const digest = lease.standingPromptDigest;
    writeFileSync(join(directory, "MEMORY.md"), "Updated complete memory", {
      mode: 0o600,
    });
    const next = await startupMemorySystemLease({
      participantId: "agent-1",
      memoryDirectory: directory,
      promptLease: {
        env: {},
        args: ["--prompt", "Standing role"],
        standingPromptDigest: "base-digest",
      },
    });
    assert.equal(
      next.standingPromptDigest,
      digest,
      "data changes do not reset the Agent's provider session",
    );
    assert.notEqual(
      next.env.RAH_AGENT_MEMORY_SYSTEM_SHA256,
      lease.env.RAH_AGENT_MEMORY_SYSTEM_SHA256,
    );
    assert.ok(
      readFileSync(next.args![1]!, "utf8").includes("Updated complete memory"),
    );
    await next.release?.();
    await lease.release?.();
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("system memory is restricted to drivers with snapshot-aware native resume", async () => {
  const { useSystemMemoryTransport } =
    await import("../src/startup-memory-system-lease.ts");
  assert.equal(useSystemMemoryTransport("system", "claude"), true);
  assert.equal(useSystemMemoryTransport(undefined, "claude"), true);
  assert.equal(useSystemMemoryTransport(undefined, "codex"), true);
  assert.equal(useSystemMemoryTransport("tool", "claude"), false);
  assert.equal(useSystemMemoryTransport("system", "codex"), true);
  for (const runtime of ["kimi", "opencode", undefined])
    assert.equal(useSystemMemoryTransport("system", runtime), false);
});
