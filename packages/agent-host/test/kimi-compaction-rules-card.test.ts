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
  protocolUpdateNotice,
  renderStandingProtocolCard,
  runtimeSupportsBodiedWake,
} from "../src/index.ts";

/**
 * S2-c2 (owner idea, source-verified necessity): Kimi ACP cannot set a system
 * prompt (`session/new` has no agent/system slot in kimi-code 0.39.1), so the
 * standing rules are a user turn of the session's first prompt. kimi-code's
 * compaction keeps real user messages only within a 20k-token budget (2k head
 * + 18k tail) and summarizes everything else, so the first message's rules
 * are truncated once a session's user messages exceed that budget. After
 * EVERY compaction the next wake therefore starts with the compact rules
 * card (`worker help protocol`), deduped by compaction identity and recorded
 * on the Host's session binding. A resumed session with an older protocol
 * gets the card instead of the one-line notice (Kimi has no system layer).
 */

const key = {
  participantId: "instance-card",
  provider: "kimi-acp/v1",
  runtimeProfileRevisionId: "runtime-profile-revision",
  workspaceMountRevisionId: "workspace-mount-revision",
};

test("the binding records compactions by identity and which one the rules card answered", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-card-store-"));
  chmodSync(directory, 0o700);
  try {
    const store = new ProviderSessionStore({ rootDirectory: directory });
    const options = { instance: true, instanceGeneration: 0 };
    await store.record(key, "session-a", options);
    assert.equal(
      await store.recordCompaction(key, options, "session-a", "run-1#1"),
      true,
    );
    // The same compaction reported again is not a new one.
    await store.recordCompaction(key, options, "session-a", "run-1#1");
    let bound = await store.load(key, options);
    assert.equal(bound?.lastCompactionId, "run-1#1");
    assert.equal(bound?.compactionCount, 1);
    assert.equal(bound?.rulesCardCompactionId, undefined);
    // A later run reports the same session again: the facts survive.
    await store.record(key, "session-a", options);
    await store.recordCompaction(key, options, "session-a", "run-2#1");
    bound = await store.load(key, options);
    assert.equal(bound?.lastCompactionId, "run-2#1");
    assert.equal(bound?.compactionCount, 2);
    await store.acceptRulesCard(key, options, "session-a", "run-2#1");
    bound = await store.load(key, options);
    assert.equal(bound?.rulesCardCompactionId, "run-2#1");
    // Another session never inherits or rewrites these facts.
    assert.equal(
      await store.recordCompaction(key, options, "session-other", "x#1"),
      false,
    );
    await store.acceptRulesCard(key, options, "session-other", "x#1");
    bound = await store.load(key, options);
    assert.equal(bound?.providerSessionId, "session-a");
    assert.equal(bound?.lastCompactionId, "run-2#1");
    assert.equal(bound?.rulesCardCompactionId, "run-2#1");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("Kimi carries a bodied wake: the driver's turn-update acceptance is the capability", () => {
  assert.equal(runtimeSupportsBodiedWake("kimi-acp/v1"), true);
});

test("after every compaction the next Kimi wake starts with the rules card once, until a carrying turn is accepted", async () => {
  const context = await fixture();
  try {
    const card = renderStandingProtocolCard();
    const cards = (prompt: string) => prompt.split(card).length - 1;
    const created = await context.run("seed", "reply");
    assert.match(created.prompt, /canonical room worker prompt/u);
    assert.equal(cards(created.prompt), 0, "a new session holds the rules");
    assert.equal(cards((await context.run("plain", "reply")).prompt), 0);

    // Two compactions in one turn: one card on the next wake.
    const compacted = await context.run("compact", "compact2+reply");
    assert.equal(cards(compacted.prompt), 0);
    let bound = await context.binding();
    assert.equal(bound?.compactionCount, 2);
    assert.equal(bound?.lastCompactionId, `${compacted.runAttemptId}#2`);
    const first = await context.run("card-1", "reply");
    assert.equal(cards(first.prompt), 1);
    assert.ok(
      first.prompt.indexOf(card) < first.prompt.indexOf("message-check"),
      "the card precedes the wake",
    );
    // Not accepted (no completion evidence): the next wake repeats it.
    const second = await context.run("card-2", "reply");
    assert.equal(cards(second.prompt), 1);
    // A run that did not carry the card cannot answer the compaction.
    await context.runtime.acceptSessionProtocol!({
      participantId: context.participantId,
      runAttemptId: compacted.runAttemptId,
    });
    assert.equal(cards((await context.run("card-3", "reply")).prompt), 1);
    await context.runtime.acceptSessionProtocol!({
      participantId: context.participantId,
      runAttemptId: `run-card-3`,
    });
    bound = await context.binding();
    assert.equal(bound?.rulesCardCompactionId, `${compacted.runAttemptId}#2`);
    assert.equal(cards((await context.run("after", "reply")).prompt), 0);

    // A compaction inside the turn that carried the card needs another card.
    const again = await context.run("card-again", "compact1+reply");
    assert.equal(cards(again.prompt), 0);
    const next = await context.run("card-next", "reply");
    assert.equal(cards(next.prompt), 1);
    await context.runtime.acceptSessionProtocol!({
      participantId: context.participantId,
      runAttemptId: "run-card-next",
    });
    assert.equal(cards((await context.run("quiet", "reply")).prompt), 0);
  } finally {
    await context.close();
  }
});

test("a compaction in a new session's first run is recorded once its binding exists", async () => {
  const context = await fixture();
  try {
    const seed = await context.run("seed", "compact1+reply");
    const bound = await context.binding();
    assert.equal(bound?.lastCompactionId, `${seed.runAttemptId}#1`);
    const next = await context.run("next", "reply");
    assert.equal(next.prompt.split(renderStandingProtocolCard()).length - 1, 1);
  } finally {
    await context.close();
  }
});

test("a resumed Kimi session with an older protocol gets the rules card instead of the notice line", async () => {
  const context = await fixture();
  try {
    const card = renderStandingProtocolCard();
    context.setProtocolVersion("p1");
    await context.run("seed", "reply");
    context.setProtocolVersion("p2");
    const upgraded = await context.run("upgrade", "reply");
    assert.equal(upgraded.prompt.split(card).length - 1, 1);
    assert.equal(upgraded.prompt.includes(protocolUpdateNotice("p2")), false);
    await context.runtime.acceptSessionProtocol!({
      participantId: context.participantId,
      runAttemptId: "run-upgrade",
    });
    assert.equal((await context.binding())?.standingProtocolVersion, "p2");
    assert.equal(
      (await context.run("after", "reply")).prompt.includes(card),
      false,
    );
  } finally {
    await context.close();
  }
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-kimi-card-"));
  chmodSync(directory, 0o700);
  const executable = join(directory, "fake-kimi.mjs");
  const recordPath = join(directory, "record.jsonl");
  writeFileSync(
    executable,
    readFileSync(
      fileURLToPath(new URL("./fixtures/fake-kimi-acp.mjs", import.meta.url)),
    ),
    { mode: 0o700 },
  );
  const profileRegistry = new RuntimeProfileRegistry({
    databasePath: join(directory, "runtime-registry.db"),
    hostId: "host-card",
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
  const store = new ProviderSessionStore({
    rootDirectory: join(directory, "provider-sessions"),
  });
  let scenario = "reply";
  let protocolVersion = "p1";
  const participantId = "instance-kimi-card";
  const runtime = implementations.createRuntime(active, report, {
    activationEnvironment: () => ({
      args: ["--prompt", "canonical room worker prompt"],
      env: {
        FAKE_RECORD: recordPath,
        FAKE_SCENARIO: scenario,
        FAKE_TOOL_COMMAND: ": FAKE tool",
        FAKE_FOLLOW_UP_MS: "0",
      },
      standingPromptDigest: "sha256-standing-prompt-digest",
      standingProtocolVersion: protocolVersion,
    }),
    cwd: directory,
    providerSessionStore: store,
    supervisorDirectory: join(directory, "supervisors"),
  });
  const run = async (suffix: string, next: string) => {
    scenario = next;
    const activationId = `activation-${suffix}`;
    const runAttemptId = `run-${suffix}`;
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
        hostId: "host-card",
        participantId,
        reason: "manual",
        roomId: "room-card",
        runAttemptId,
        toSeq: 1,
      },
      {
        recordInstanceSessionBinding: async () => undefined,
        recordTrajectory: async () => undefined,
        recordUsageGap: async () => undefined,
        registerPrepared: async () => undefined,
      },
    );
    const exit = await runtime.reap(handle);
    assert.equal(exit.code, 0, JSON.stringify(runtime.diagnostics?.(handle)));
    const prompts = readFileSync(recordPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter(
        (record) =>
          record.activationId === activationId && record.event === "prompt",
      )
      .map((record) => record.text as string);
    assert.equal(prompts.length, 1);
    return { prompt: prompts[0]!, runAttemptId };
  };
  return {
    participantId,
    runtime,
    run,
    setProtocolVersion(next: string) {
      protocolVersion = next;
    },
    binding: async () =>
      await store.load(
        {
          participantId,
          provider: "kimi-acp/v1",
          runtimeProfileRevisionId: active.runtimeProfileRevisionId,
          standingPromptDigest: "sha256-standing-prompt-digest",
          workspaceMountRevisionId: "workspace-mount-card-v1",
        },
        { instance: true, instanceGeneration: 0 },
      ),
    async close() {
      profileRegistry.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

function instanceAgent(participantId: string): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: `agent-definition-${participantId}`,
      agentDefinitionRevisionId: `agent-definition-revision-${participantId}`,
      contentDigest: `sha256:${"a".repeat(64)}`,
      createdAt: "2026-09-25T00:00:00.000Z",
      createdBy: "principal-owner",
      executionPolicyRevisionId: "execution-policy-card",
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
    instanceChannelId: "channel-card",
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
    displayName: "FAKE Kimi rules card server",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "kimi-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers:
      process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-kimi-card-server",
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
      agentDefinitionRevisionId: "agent-definition-card-v1",
      contentDigest: `sha256:${"a".repeat(64)}` as const,
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-card",
        contentDigest: `sha256:${"b".repeat(64)}` as const,
        versionId: "memory-card-v1",
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
      workspaceDefinitionId: "workspace-card",
      workspaceMode: "in_place" as const,
      workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
      workspaceMountRevisionId: "workspace-mount-card-v1",
    },
    roomId: "room-card",
    runAttemptId: input.runAttemptId,
    schemaVersion: 1 as const,
    throughRoomSeq: 1,
  };
}
