import { allowsAgentChannelAttention } from "../../kernel/src/agent-channel-attention.ts";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

async function fixture(
  profileMetadata?: import("@rah-os/kernel").WorkerProfileMetadataPort,
) {
  const directory = mkdtempSync(join(tmpdir(), "rah-mute-")),
    path = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath: path });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ kind: "human", handle: "human" }),
    agent = kernel.provisionPrincipal({ kind: "agent", handle: "quiet" }),
    other = kernel.provisionPrincipal({ kind: "agent", handle: "other" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    room = kernel.createRoom(actor, { name: "Channel", slug: "channel" });
  for (const id of [agent.principal.principalId, other.principal.principalId])
    kernel.addMember(actor, { roomId: room.roomId, principalId: id });
  kernel.postRoomMessage(actor, {
    roomId: room.roomId,
    body: "Begin",
    idempotencyKey: "begin",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
  assert.ok(activation);
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "mute", metadata: {} },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const service = new WorkerApplicationService({
    ...(profileMetadata ? { profileMetadata } : {}),
    kernel,
    serviceInfo: () => ({
      buildVersion: "actual-daemon-test",
      protocolVersion: 7,
    }),
  });
  await service.start();
  const credential = service.issueActivationCredential(host, {
    activationId: activation.activationId,
    consumerId: "mute-test",
    hostId: host.hostId,
    participantId: agent.principal.principalId,
    roomId: room.roomId,
    runAttemptId: run.runAttemptId,
    toSeq: activation.toSeq,
  });
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${service.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  await call("sync");
  const db = new DatabaseSync(path),
    token = join(directory, "token");
  writeFileSync(token, credential.accessToken, { mode: 0o600 });
  const cli = async (args: string[]) =>
    promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runWorkerCliCommand} from ${JSON.stringify(new URL("../../agent-host/src/worker-cli.ts", import.meta.url).href)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
        "worker",
        ...args,
      ],
      {
        env: {
          ...process.env,
          RAH_WORKER_API_URL: service.origin!,
          RAH_WORKER_SESSION_FILE: token,
        },
        timeout: 20000,
      },
    );
  const latest = () =>
    Number(
      db
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(room.roomId)!.n,
    );
  const delivered = (
    eventId: string,
    participantId = agent.principal.principalId,
  ) =>
    db
      .prepare(
        "SELECT * FROM inbox_items WHERE event_id=? AND participant_id=?",
      )
      .get(eventId, participantId);
  const post = (key: string, mention = false) =>
    kernel.postRoomMessage(actor, {
      roomId: room.roomId,
      body: mention ? "@quiet please reply" : "ordinary news",
      idempotencyKey: key,
      recipients: mention
        ? [{ participantId: agent.principal.principalId, reason: "mention" }]
        : [],
      basedOnRoomSeq: latest(),
    });
  let handlesClosed = false;
  const closeHandles = async () => {
    if (handlesClosed) return;
    handlesClosed = true;
    await service.close();
    db.close();
    kernel.close();
  };
  return {
    directory,
    path,
    kernel,
    db,
    human,
    actor,
    agent,
    other,
    room,
    activation,
    run,
    host,
    runtime,
    service,
    credential,
    call,
    cli,
    latest,
    delivered,
    post,
    closeHandles,
    async close() {
      await closeHandles();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("version and whoami use authenticated live daemon context with no token or caller identity override", async () => {
  const f = await fixture();
  try {
    const before = f.latest();
    const v = await f.call("version", {});
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.deepEqual(v.body, {
      source: "serving_daemon",
      buildVersion: "actual-daemon-test",
      protocolVersion: 7,
    });
    const who = await f.call("auth/whoami", {});
    assert.equal(who.status, 200);
    assert.equal(who.body.participantId, f.agent.principal.principalId);
    assert.equal(who.body.runAttemptId, f.run.runAttemptId);
    assert.equal(who.body.toSeq, f.activation.toSeq);
    assert.equal(who.body.token, "[REDACTED]");
    assert.ok(!JSON.stringify(who.body).includes(f.credential.accessToken));
    assert.equal(f.latest(), before);
    assert.equal(
      (
        await f.call("auth/whoami", {
          participantId: f.other.principal.principalId,
        })
      ).status,
      400,
    );
    assert.equal((await f.call("version", { token: "forged" })).status, 400);
    const cli = JSON.parse((await f.cli(["whoami"])).stdout);
    assert.equal(cli.participantId, f.agent.principal.principalId);
    assert.equal(cli.token, "[REDACTED]");
    // Raft's `version` is one of its 19 `--json` commands: text by default.
    const cv = (await f.cli(["version"])).stdout;
    assert.match(cv, /^RAH CLI: @rah-os\/agent-host \S+$/mu);
    assert.match(cv, /^RAH daemon \(live\): actual-daemon-test$/mu);
    const cvJson = JSON.parse((await f.cli(["version", "--json"])).stdout);
    assert.equal(cvJson.buildVersion, "actual-daemon-test");
    assert.equal(cvJson.cliCarrier.name, "@rah-os/agent-host");
    assert.ok(cvJson.cliCarrier.version);
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    assert.equal((await f.call("auth/whoami", {})).status, 403);
    assert.equal((await f.call("version", {})).status, 403);
    f.credential.revoke();
    assert.equal((await f.call("version", {})).status, 401);
    assert.equal((await f.call("auth/whoami", {})).status, 401);
  } finally {
    await f.close();
  }
});

test("profile/members/serverInfo carry live safe Computer metadata through the authenticated HTTP and child CLI facades", async () => {
  let name = "Original Computer",
    calls = 0;
  const f = await fixture({
    computer: (hostId) => {
      calls++;
      return {
        hostId,
        displayName: name,
        hostname: "host.local",
        os: "darwin arm64",
        description: null,
        connection: {
          status: "online",
          observedAt: new Date().toISOString(),
          staleAfterMs: 30000,
        },
      };
    },
    runtime: () => undefined,
  });
  try {
    const before = f.latest();
    for (const route of ["profiles/get", "room/members", "server/info"]) {
      const result = await f.call(route, {});
      assert.equal(result.status, 200, JSON.stringify(result.body));
      const profile =
        route === "profiles/get"
          ? result.body
          : route === "server/info"
            ? result.body.runtimeContext
            : result.body.members.find((p: any) => p.isSelf);
      assert.equal(profile.actualRun.computer.displayName, name);
      assert.equal(profile.actualRun.runtime, undefined);
    }
    name = "Edited Computer";
    // `raft profile show` prints `formatProfile` unless `--json` is passed, so
    // the default read is text and the flag is what returns the object.
    const cliText = (
      await f.cli(["profile-show", "--created-agents-limit", "1"])
    ).stdout;
    assert.match(cliText, /^- Computer: Edited Computer \(/mu);
    assert.match(cliText, /^## Profile$/mu);
    const cli = JSON.parse(
      (await f.cli(["profile-show", "--created-agents-limit", "1", "--json"]))
        .stdout,
    );
    assert.equal(cli.actualRun.computer.displayName, name);
    assert.equal(f.latest(), before);
    assert.equal(
      (await f.call("profiles/get", { createdAgentsCursor: "invalid" })).status,
      403,
    );
    const previousCalls = calls;
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.room.roomId, f.agent.principal.principalId);
    assert.equal((await f.call("profiles/get")).status, 403);
    assert.equal(calls, previousCalls);
    f.credential.revoke();
    assert.equal((await f.call("server/info")).status, 401);
    assert.equal(calls, previousCalls);
  } finally {
    await f.close();
  }
});
