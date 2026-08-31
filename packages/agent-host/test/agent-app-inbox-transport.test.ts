import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createAgentAppInboxEnvironment } from "../src/agent-app-inbox-transport.ts";
import { AgentMemoryConfigStore } from "../src/agent-memory-config-store.ts";

test("real CLI child uses only its Computer-local App Inbox capability and loses access on release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-inbox-transport-"));
  const calls: unknown[] = [];
  const configs = new AgentMemoryConfigStore(directory);
  const port = {
    getCleanerConfig: configs.get.bind(configs),
    patchCleanerConfig: configs.patch.bind(configs),
    recheckInbox: async () => ({ items: [], measurement: "under_threshold" }),
    checkInbox: async (owner: string) => {
      calls.push(["check", owner]);
      return { items: [], measurement: "under_threshold" };
    },
    acknowledgeHint: (owner: string, itemId: string, version: number) => {
      calls.push(["ack", owner, itemId, version]);
      return {
        acknowledged: true,
        proofScope: "notification_acknowledged_not_memory_cleaned" as const,
      };
    },
  };
  const lease = await createAgentAppInboxEnvironment({
    credentialDirectory: directory,
    ownerParticipantId: "alice",
    port,
  });
  try {
    assert.deepEqual(Object.keys(lease.env).sort(), [
      "RAH_AGENT_INBOX_API_URL",
      "RAH_AGENT_INBOX_CLI",
      "RAH_AGENT_INBOX_SESSION_FILE",
    ]);
    const cli = lease.env.RAH_AGENT_INBOX_CLI!;
    const origin = lease.env.RAH_AGENT_INBOX_API_URL!;
    const tokenPath = lease.env.RAH_AGENT_INBOX_SESSION_FILE!;
    const token = await readFile(tokenPath, "utf8");
    assert.equal(JSON.stringify(lease.env).includes(token), false);
    assert.equal((await readFile(cli, "utf8")).includes(token), false);
    const exec = (args: string[]) =>
      promisify(execFile)(cli, args, {
        env: { PATH: process.env.PATH, ...lease.env },
        timeout: 5_000,
      });
    assert.deepEqual(
      JSON.parse((await exec(["agent", "inbox", "check"])).stdout),
      { items: [], measurement: "under_threshold" },
    );
    assert.deepEqual(
      JSON.parse(
        (
          await exec([
            "agent",
            "inbox",
            "ack",
            "--item-id",
            "hint-1",
            "--version",
            "2",
          ])
        ).stdout,
      ),
      {
        acknowledged: true,
        proofScope: "notification_acknowledged_not_memory_cleaned",
      },
    );
    assert.deepEqual(calls, [
      ["check", "alice"],
      ["ack", "alice", "hint-1", 2],
    ]);
    await assert.rejects(exec(["agent", "inbox", "check", "--owner", "bob"]));
    await assert.rejects(
      exec(["worker", "sync"]),
      /RAH_WORKER_API_URL is missing/,
    );
    assert.equal(calls.length, 2);
    const post = (
      path: string,
      body: unknown,
      extraHeaders: Record<string, string> = {},
    ) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/v1/agent-inbox/check", { ownerParticipantId: "bob" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post("/v1/agent-inbox/ack", {
          itemId: "hint-1",
          version: 2,
          owner: "bob",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/v1/agent-inbox/check",
          {},
          { authorization: "Bearer wrong" },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await post(
          "/v1/agent-inbox/check",
          {},
          { origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    assert.equal((await post("/v1/worker/messages/post", {})).status, 404);
    assert.equal(
      (await post("/v1/agent-config/get", { ownerParticipantId: "bob" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post("/v1/agent-config/patch", {
          expectedRevision: 0,
          set: { enabled: false },
          owner: "bob",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/v1/agent-config/patch",
          { expectedRevision: 0, set: { enabled: false } },
          { origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post("/v1/agent-config/patch", {
          expectedRevision: 0,
          set: { enabled: false },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/v1/agent-config/patch", {
          expectedRevision: 0,
          set: { enabled: true },
        })
      ).status,
      409,
    );
    assert.equal(configs.get("alice").effective.enabled, false);
    assert.equal(configs.get("bob").revision, 0);
    assert.equal(
      (await post("/v1/agent-inbox/check", { huge: "x".repeat(4_097) })).status,
      413,
    );
    assert.equal(calls.length, 2);
    await lease.release?.();
    await lease.release?.();
    assert.equal(existsSync(dirname(tokenPath)), false);
    await assert.rejects(post("/v1/agent-inbox/check", {}));
  } finally {
    await lease.release?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test("revoking an App Inbox lease fences an in-flight request before acknowledgement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rah-inbox-revoke-"));
  let checks = 0;
  let resolveCheck!: (value: unknown) => void;
  const lease = await createAgentAppInboxEnvironment({
    credentialDirectory: directory,
    ownerParticipantId: "alice",
    port: {
      recheckInbox: async () => ({ items: [], measurement: "under_threshold" }),
      checkInbox: async () => {
        checks++;
        return await new Promise((resolve) => {
          resolveCheck = resolve;
        });
      },
      acknowledgeHint: () => {
        throw new Error("must not ack");
      },
    },
  });
  try {
    const token = await readFile(
      lease.env.RAH_AGENT_INBOX_SESSION_FILE!,
      "utf8",
    );
    const response = fetch(
      `${lease.env.RAH_AGENT_INBOX_API_URL}/v1/agent-inbox/check`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      },
    ).catch(() => null);
    while (checks === 0) await new Promise((resolve) => setImmediate(resolve));
    await lease.release?.();
    resolveCheck({ items: [], measurement: "under_threshold" });
    assert.equal(await response, null);
  } finally {
    await lease.release?.();
    await rm(directory, { recursive: true, force: true });
  }
});
