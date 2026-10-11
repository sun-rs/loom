import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type {
  AgentRuntimeContext,
  RuntimeProfileManifestV3,
} from "@rah-os/protocol";

import {
  ProviderSessionStore,
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
  STANDING_PROTOCOL_VERSION,
  WORKER_CLI_HELP_TOPIC_NAMES,
  WORKER_HELP_TOPIC_NAMES,
  providerActivationInput,
  protocolUpdateNotice,
  renderStandingProtocolCard,
  runWorkerCliCommand,
} from "../src/index.ts";

/**
 * P2-3 (2026-09-25 review): a resumed native session keeps the standing
 * prompt it was created with. Its binding records the protocol version that
 * session actually received; a newer compiled protocol adds ONE compact wake
 * line pointing at `help protocol`, and the binding advances only after a
 * turn that carried the line was accepted (the Host's completion evidence).
 */

const key = {
  participantId: "instance-protocol",
  provider: "kimi-acp/v1",
  runtimeProfileRevisionId: "runtime-profile-revision",
  workspaceMountRevisionId: "workspace-mount-revision",
};

test("an instance binding keeps the protocol version its session was created with until accepted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-protocol-store-"));
  chmodSync(directory, 0o700);
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    const options = { instance: true, instanceGeneration: 0 };
    await store.record(key, "session-a", {
      ...options,
      standingProtocolVersion: "p1",
    });
    // Every resumed run reports its session again with the current version;
    // the session did not receive it, so the binding keeps the original.
    await store.record(key, "session-a", {
      ...options,
      standingProtocolVersion: "p2",
    });
    assert.equal(
      (await store.load(key, options))?.standingProtocolVersion,
      "p1",
    );
    await store.acceptStandingProtocol(key, options, "session-a", "p2");
    assert.equal(
      (await store.load(key, options))?.standingProtocolVersion,
      "p2",
    );
    // Acceptance never rebinds another session.
    await store.acceptStandingProtocol(key, options, "session-other", "p3");
    const current = await store.load(key, options);
    assert.equal(current?.standingProtocolVersion, "p2");
    assert.equal(current?.providerSessionId, "session-a");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the fixed wake appends the protocol notice line from its own env fence", () => {
  const previous = process.env.RAH_PROTOCOL_NOTICE;
  try {
    process.env.RAH_PROTOCOL_NOTICE = protocolUpdateNotice("abc123");
    const text = providerActivationInput("");
    assert.equal(
      text,
      `Run message-check --startup first.\n${protocolUpdateNotice("abc123")}`,
    );
    delete process.env.RAH_PROTOCOL_NOTICE;
    assert.equal(
      providerActivationInput(""),
      "Run message-check --startup first.",
    );
  } finally {
    if (previous === undefined) delete process.env.RAH_PROTOCOL_NOTICE;
    else process.env.RAH_PROTOCOL_NOTICE = previous;
  }
});

test("worker help protocol renders the current compact rules card", async () => {
  assert.ok(WORKER_CLI_HELP_TOPIC_NAMES.includes("protocol"));
  // New sessions already hold the protocol: the prompt pointer omits it.
  assert.equal(WORKER_HELP_TOPIC_NAMES.includes("protocol" as never), false);
  let stdout = "";
  const status = await runWorkerCliCommand(["worker", "help", "protocol"], {
    env: {},
    fetch: async () => {
      throw new Error("help must not reach the Worker API");
    },
    stderr: { write: () => undefined },
    stdout: { write: (value: string) => (stdout += value) },
  } as never);
  assert.equal(status, 0);
  assert.equal(stdout, `${renderStandingProtocolCard()}\n`);
  assert.ok(stdout.includes(`v${STANDING_PROTOCOL_VERSION}`));
  assert.match(stdout, /message-post <Reply context arguments>/u);
  assert.match(stdout, /--based-on-room-seq/u);
  // It summarizes the rules; it never claims the native system prompt changed.
  assert.doesNotMatch(stdout, /system prompt (was |has been )?replaced/iu);
  assert.match(
    protocolUpdateNotice(STANDING_PROTOCOL_VERSION),
    new RegExp(
      `^Protocol updated \\(v${STANDING_PROTOCOL_VERSION}\\): .*help protocol`,
      "u",
    ),
  );
  assert.equal(protocolUpdateNotice("x").includes("\n"), false);
  assert.doesNotMatch(protocolUpdateNotice("x"), /Task creation now requires/u);
  assert.match(
    protocolUpdateNotice("x"),
    /current wake.*selected reply transport.*help protocol/u,
  );
});

test("S2-c2: a resumed Kimi instance session gets the protocol card (no system layer) until a carrying turn is accepted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-kimi-protocol-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-kimi.mjs");
    const recordPath = join(directory, "record.jsonl");
    writeFileSync(executable, fakeKimiServer, { mode: 0o700 });
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-protocol",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest(manifest(executable));
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    let protocolVersion: string | undefined;
    const runtime = implementations.createRuntime(active, report, {
      activationEnvironment: () => ({
        args: ["--prompt", "canonical room worker prompt"],
        env: {
          FAKE_KIMI_RECORD_PATH: recordPath,
          // Never the user's real Kimi home.
          KIMI_CODE_HOME: join(directory, "kimi-home"),
        },
        standingPromptDigest: "sha256-standing-prompt-digest",
        ...(protocolVersion === undefined
          ? {}
          : { standingProtocolVersion: protocolVersion }),
      }),
      cwd: directory,
      providerSessionStore: new ProviderSessionStore({
        rootDirectory: join(directory, "provider-sessions"),
      }),
      supervisorDirectory: join(directory, "supervisors"),
    });
    assert.equal(typeof runtime.acceptSessionProtocol, "function");
    const run = async (participantId: string, suffix: string) => {
      const activationId = `activation-${participantId}-${suffix}`;
      const runAttemptId = `run-${participantId}-${suffix}`;
      const handle = await runtime.start(
        {
          activationId,
          agent: instanceAgent(participantId),
          consumerId: `consumer-${suffix}`,
          contextManifest: contextManifest({
            activationId,
            contentDigest: active.contentDigest,
            participantId,
            runAttemptId,
            runtimeProfileRevisionId: active.runtimeProfileRevisionId,
          }),
          fromSeq: 1,
          hostId: "host-protocol",
          participantId,
          reason: "manual",
          roomId: "room-protocol",
          runAttemptId,
          toSeq: 1,
        },
        {
          recordInstanceSessionBinding: async () => undefined,
          recordTrajectory: async () => undefined,
          registerPrepared: async () => undefined,
        },
      );
      assert.equal((await runtime.reap(handle)).code, 0);
      const prompts = readFileSync(recordPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter(
          (record) =>
            record.activationId === activationId &&
            record.frame?.method === "session/prompt",
        )
        .map((record) => record.frame.params.prompt[0].text as string);
      assert.equal(prompts.length, 1);
      return { prompt: prompts[0]!, runAttemptId };
    };
    // Kimi ACP has no system layer: the current rules card itself rides in
    // the wake instead of the one-line notice.
    const card = renderStandingProtocolCard();
    const noticeCount = (prompt: string) => {
      assert.equal(
        prompt.includes("Protocol updated"),
        false,
        "the card replaces the notice line",
      );
      return prompt.split(card).length - 1;
    };

    // Created under p1: the full prompt, no notice.
    protocolVersion = "p1";
    const created = await run("instance-a", "seed");
    assert.match(created.prompt, /canonical room worker prompt/u);
    assert.equal(noticeCount(created.prompt), 0);
    // Same protocol on resume: nothing extra.
    assert.equal(noticeCount((await run("instance-a", "same")).prompt), 0);

    // The compiled protocol changed: exactly one rules card.
    protocolVersion = "p2";
    const first = await run("instance-a", "upgrade-1");
    assert.equal(noticeCount(first.prompt), 1);
    assert.doesNotMatch(first.prompt, /canonical room worker prompt/u);
    // Not accepted (no completion evidence): the next turn repeats it.
    const second = await run("instance-a", "upgrade-2");
    assert.equal(noticeCount(second.prompt), 1);
    // A run that did not carry the line cannot advance the binding.
    await runtime.acceptSessionProtocol!({
      participantId: "instance-a",
      runAttemptId: "run-instance-a-seed",
    });
    assert.equal(noticeCount((await run("instance-a", "upgrade-3")).prompt), 1);
    await runtime.acceptSessionProtocol!({
      participantId: "instance-a",
      runAttemptId: "run-instance-a-upgrade-3",
    });
    assert.equal(noticeCount((await run("instance-a", "after")).prompt), 0);

    // A binding recorded before protocol tracking has no version: unknown
    // counts as outdated, once, until accepted.
    protocolVersion = undefined;
    await run("instance-b", "seed");
    protocolVersion = "p2";
    assert.equal(noticeCount((await run("instance-b", "upgrade")).prompt), 1);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("S2-c1: a resumed Claude instance session gets one protocol line in its stdin input until accepted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-claude-protocol-"));
  chmodSync(directory, 0o700);
  try {
    const executable = join(directory, "fake-claude.mjs");
    const recordPath = join(directory, "record.jsonl");
    writeFileSync(
      executable,
      readFileSync(
        fileURLToPath(
          new URL("./fixtures/fake-claude-stream.mjs", import.meta.url),
        ),
      ),
      { mode: 0o700 },
    );
    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: join(directory, "runtime-registry.db"),
      hostId: "host-protocol",
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const revision = profileRegistry.importManifest({
      ...manifest(executable),
      adapter: {
        ...manifest(executable).adapter,
        kind: "claude-stream-json/v1",
      },
      modelCatalogProbe: { kind: "claude-cli/v1" },
      runtimeProfileId: "fake-claude-protocol",
    });
    const report = profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: directory }),
    );
    const active = profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    let protocolVersion = "p1";
    const runtime = implementations.createRuntime(
      active,
      report,
      {
        activationEnvironment: () => ({
          args: ["--prompt", "canonical room worker prompt"],
          env: { FAKE_RECORD: recordPath, FAKE_TOOL: "none" },
          standingPromptDigest: "sha256-standing-prompt-digest",
          standingProtocolVersion: protocolVersion,
        }),
        cwd: directory,
        providerSessionStore: new ProviderSessionStore({
          rootDirectory: join(directory, "provider-sessions"),
        }),
        supervisorDirectory: join(directory, "supervisors"),
      },
      undefined,
      "full_access",
    );
    const run = async (suffix: string) => {
      const participantId = "instance-claude";
      const activationId = `activation-claude-${suffix}`;
      const runAttemptId = `run-claude-${suffix}`;
      const before = readRecords(recordPath).length;
      const handle = await runtime.start(
        {
          activationId,
          agent: instanceAgent(participantId),
          consumerId: `consumer-${suffix}`,
          contextManifest: contextManifest({
            activationId,
            contentDigest: active.contentDigest,
            participantId,
            runAttemptId,
            runtimeProfileRevisionId: active.runtimeProfileRevisionId,
          }),
          fromSeq: 1,
          hostId: "host-protocol",
          participantId,
          reason: "manual",
          roomId: "room-protocol",
          runAttemptId,
          toSeq: 1,
        },
        {
          recordInstanceSessionBinding: async () => undefined,
          recordTrajectory: async () => undefined,
          registerPrepared: async () => undefined,
        },
      );
      const exit = await runtime.reap(handle);
      assert.equal(exit.code, 0, JSON.stringify(runtime.diagnostics?.(handle)));
      const records = readRecords(recordPath).slice(before);
      const inputs = records.filter((r) => r.kind === "input");
      assert.equal(inputs.length, 1);
      const spawn = records.find((r) => r.kind === "spawn")!;
      return {
        input: inputs[0]!.text as string,
        resumed: (spawn.args as string[]).includes("--resume"),
      };
    };
    const noticeCount = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("Protocol updated"))
        .length;
    const created = await run("seed");
    assert.equal(created.resumed, false);
    assert.equal(noticeCount(created.input), 0);
    const same = await run("same");
    assert.equal(same.resumed, true, "the recorded session is resumed");
    assert.equal(noticeCount(same.input), 0);
    // The standing prompt Claude recorded at the session's first request
    // stays until compaction: a newer protocol reaches it as one wake line.
    protocolVersion = "p2";
    const first = await run("upgrade-1");
    assert.equal(noticeCount(first.input), 1);
    assert.ok(first.input.includes(protocolUpdateNotice("p2")));
    assert.equal(noticeCount((await run("upgrade-2")).input), 1);
    await runtime.acceptSessionProtocol!({
      participantId: "instance-claude",
      runAttemptId: "run-claude-upgrade-2",
    });
    assert.equal(noticeCount((await run("after")).input), 0);
    profileRegistry.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function readRecords(path: string): Record<string, unknown>[] {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function instanceAgent(participantId: string): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: `agent-definition-${participantId}`,
      agentDefinitionRevisionId: `agent-definition-revision-${participantId}`,
      contentDigest: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-09-25T00:00:00.000Z",
      createdBy: "principal-owner",
      executionPolicyRevisionId: "execution-policy-protocol",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy",
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionId: "room-memory-v1",
      },
      revision: 1,
      role: "Reviewer",
      skillRefs: [],
    },
    instanceChannelId: "channel-protocol",
    participantId,
    schemaVersion: 1,
  };
}

function manifest(executable: string): RuntimeProfileManifestV3 {
  return {
    adapter: {
      config: { diagnosticByteLimit: 262_144, terminationGraceMs: 1_000 },
      executable,
      fixedArgs: [],
      kind: "kimi-acp/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "Fake Kimi protocol server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "kimi-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-kimi-protocol-server",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  };
}

function contextManifest(input: {
  activationId: string;
  contentDigest: string;
  participantId: string;
  runAttemptId: string;
  runtimeProfileRevisionId: string;
}) {
  return {
    activationId: input.activationId,
    agentDefinition: {
      agentDefinitionRevisionId: "agent-definition-protocol-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-protocol",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-protocol-v1",
      },
      skillRefs: [],
    },
    contentDigest: `sha256:${"c".repeat(64)}` as const,
    contextManifestId: `context-${input.runAttemptId}`,
    createdAt: "2026-09-25T00:00:00.000Z",
    eventRanges: [{ fromSeq: 1, toSeq: 1 }],
    participantId: input.participantId,
    placement: {
      placementId: `placement-${input.participantId}`,
      runtimeProfileDigest: input.contentDigest as `sha256:${string}`,
      runtimeProfileRevisionId: input.runtimeProfileRevisionId,
      workspaceDefinitionId: "workspace-protocol",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-protocol-v1",
    },
    roomId: "room-protocol",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}

const fakeKimiServer = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args.join(" ") === "provider list --json") {
  process.stdout.write(JSON.stringify({models:{"kimi-code/k3":{defaultEffort:"high",displayName:"K3",provider:"managed:kimi-code",supportEfforts:["low","high","max"]}},providers:{}}));
  process.exit(0);
}
if (args[0] !== "acp") process.exit(64);
const activationId = process.env.RAH_ACTIVATION_ID;
const record = (frame) => appendFileSync(process.env.FAKE_KIMI_RECORD_PATH, JSON.stringify({activationId,frame}) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
let sessionId = "";
createInterface({ input: process.stdin }).on("line", (line) => {
  const frame = JSON.parse(line); record(frame);
  if (frame.method === "initialize") {
    send({jsonrpc:"2.0",id:frame.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:{resume:{}}}}});
  } else if (frame.method === "session/resume") {
    sessionId = frame.params.sessionId;
    send({jsonrpc:"2.0",id:frame.id,result:{sessionId}});
  } else if (frame.method === "session/new") {
    sessionId = "kimi-session-" + process.env.RAH_PARTICIPANT_ID;
    send({jsonrpc:"2.0",id:frame.id,result:{sessionId}});
  } else if (frame.method === "session/set_config_option") {
    send({jsonrpc:"2.0",id:frame.id,result:{configOptions:[{id:frame.params.configId,currentValue:frame.params.value}]}});
  } else if (frame.method === "session/prompt") {
    send({jsonrpc:"2.0",id:frame.id,result:{stopReason:"end_turn"}});
  }
});
`;

test("the Host accepts a session protocol only after a completed Activation", async () => {
  const { RoomKernel } = await import("@rah-os/kernel");
  const { AgentHost, FakeRuntimeAdapter } = await import("../src/index.ts");
  const directory = mkdtempSync(join(tmpdir(), "rah-protocol-host-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "ph", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "pa", kind: "agent" });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const agentActor = kernel.authenticateAccessToken(agent.accessToken);
    const room = kernel.createRoom(humanActor, { name: "p", slug: "p" });
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId: room.roomId,
    });
    const hostContext = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "protocol-host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(hostContext);
    let acknowledge = true;
    const fake = new FakeRuntimeAdapter({
      onStart: (input) => {
        if (!acknowledge) return;
        const delivery = kernel.sync(agentActor, input);
        kernel.acknowledgeCursor(agentActor, {
          ...input,
          throughSeq: delivery.cursorAfter,
        });
      },
    });
    const accepted: string[] = [];
    const host = new AgentHost({
      host: hostContext,
      kernel,
      leaseMs: 30_000,
      retryAfterMs: 0,
      runtime: {
        probe: () => fake.probe(),
        start: (input, lifecycle) => fake.start(input, lifecycle),
        reap: (run) => fake.reap(run),
        cancel: (run) => fake.cancel(run),
        acceptSessionProtocol: async (input) => {
          accepted.push(input.runAttemptId);
        },
      },
    });
    let sequence = 0;
    const post = () =>
      kernel.postMessage(humanActor, {
        body: `work ${++sequence}`,
        idempotencyKey: `protocol-${sequence}`,
        recipients: [
          { participantId: agent.principal.principalId, reason: "mention" },
        ],
        roomId: room.roomId,
      });
    // A run that exits without confirming delivery is not acceptance.
    acknowledge = false;
    fake.enqueueExit({ code: 3 });
    post();
    assert.equal((await host.reconcileOnce()).state, "failed");
    assert.deepEqual(accepted, []);
    acknowledge = true;
    assert.equal((await host.reconcileOnce()).state, "completed");
    assert.equal(accepted.length, 1);
    assert.equal(
      accepted[0],
      kernel.listRunAttempts({ roomId: room.roomId }).at(-1)?.runAttemptId,
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
