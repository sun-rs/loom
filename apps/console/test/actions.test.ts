import assert from "node:assert/strict";
import test from "node:test";

import { RahClientError } from "@rah-os/client-sdk";
import type {
  LocalRuntimeInventoryResponse,
  RoomEvent,
  RuntimeSettings,
} from "@rah-os/protocol";

import {
  ActionGate,
  STALE_RETRY_ATTEMPTS,
  activeWorkHint,
  buildMessagePost,
  buildRoleConfiguration,
  buildSettingsUpdate,
  composerKeyAction,
  isSettingsConflict,
  lifecycleEvents,
  parseAttachedDirectoryLines,
  runRoomAction,
  runtimeChoices,
  sosState,
} from "../src/actions.ts";

// FIXTURE ONLY: every identifier, path and reply below is fake test data.
const NOW = "2026-09-26T12:00:00.000Z";

function fakeSession(heads: number[]) {
  let index = 0;
  const syncs: number[] = [];
  return {
    session: {
      async syncUntilCurrent() {
        const latestRoomSeq = heads[Math.min(index, heads.length - 1)]!;
        index += 1;
        syncs.push(latestRoomSeq);
        return { caughtUp: true, state: { latestRoomSeq } };
      },
    },
    syncs,
  };
}

const stale = () => new RahClientError("stale_context", "newer facts", 409);

test("a Room action syncs first, reuses one idempotency key across stale retries and stops after the retry budget", async () => {
  const { session } = fakeSession([4, 6, 9, 12]);
  const seen: Array<[number, string]> = [];
  const result = await runRoomAction({
    action: "message",
    session,
    mutate: async (basedOnRoomSeq, key) => {
      seen.push([basedOnRoomSeq, key]);
      if (seen.length < 3) throw stale();
      return "posted";
    },
  });
  assert.equal(result, "posted");
  assert.deepEqual(
    seen.map(([seq]) => seq),
    [4, 6, 9],
    "each attempt is based on the freshly synced head",
  );
  assert.equal(new Set(seen.map(([, key]) => key)).size, 1);
  assert.match(seen[0]![1], /^console-message-/u);

  const exhausted = fakeSession([1, 2, 3, 4, 5]);
  let attempts = 0;
  await assert.rejects(
    runRoomAction({
      action: "message",
      session: exhausted.session,
      mutate: async () => {
        attempts += 1;
        throw stale();
      },
    }),
    (error: unknown) =>
      error instanceof RahClientError && error.code === "stale_context",
  );
  assert.equal(attempts, STALE_RETRY_ATTEMPTS);
  assert.equal(STALE_RETRY_ATTEMPTS, 3);
});

test("a Room action never retries a non-stale failure and each user action gets a new key", async () => {
  const { session } = fakeSession([2]);
  let attempts = 0;
  await assert.rejects(
    runRoomAction({
      action: "remove",
      session,
      mutate: async () => {
        attempts += 1;
        throw new RahClientError("conflict", "active collaboration work", 409);
      },
    }),
    /active collaboration work/u,
  );
  assert.equal(attempts, 1);

  const keys: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    await runRoomAction({
      action: "message",
      session,
      mutate: async (_seq, key) => {
        keys.push(key);
      },
    });
  }
  assert.notEqual(keys[0], keys[1]);
});

test("the action gate runs one action at a time and reports pending to every submit path", async () => {
  const gate = new ActionGate();
  const states: boolean[] = [];
  gate.onChange((pending) => states.push(pending));
  let release: () => void = () => undefined;
  const first = gate.run(
    () =>
      new Promise<string>((resolve) => {
        release = () => resolve("first");
      }),
  );
  assert.equal(gate.pending, true);
  let secondRan = false;
  const second = await gate.run(async () => {
    secondRan = true;
    return "second";
  });
  assert.equal(second, undefined, "a submit while pending is ignored");
  assert.equal(secondRan, false);
  release();
  assert.equal(await first, "first");
  assert.equal(gate.pending, false);
  await assert.rejects(
    gate.run(async () => {
      throw new Error("boom");
    }),
    /boom/u,
  );
  assert.equal(gate.pending, false, "a failure releases the gate");
  assert.deepEqual(states, [true, false, true, false]);
});

test("Enter submits, Shift+Enter inserts a newline and IME composition never submits", () => {
  const key = (overrides: Partial<Parameters<typeof composerKeyAction>[0]>) =>
    composerKeyAction({
      isComposing: false,
      key: "Enter",
      keyCode: 13,
      shiftKey: false,
      ...overrides,
    });
  assert.equal(key({}), "submit");
  assert.equal(key({ shiftKey: true }), "newline");
  assert.equal(key({ isComposing: true }), "ignore");
  assert.equal(key({ keyCode: 229 }), "ignore");
  assert.equal(key({ key: "a" }), "ignore");
});

test("attached directory lines are checked with the protocol schema before creation", () => {
  assert.deepEqual(parseAttachedDirectoryLines(""), { ok: true, value: [] });
  assert.deepEqual(
    parseAttachedDirectoryLines("  /tmp/fixture-a \n\n/tmp/fixture-b\n"),
    { ok: true, value: ["/tmp/fixture-a", "/tmp/fixture-b"] },
  );
  for (const bad of [
    "relative/path",
    "/tmp/trailing/",
    "/tmp/../escape",
    "/tmp/a\n/tmp/a",
  ]) {
    const parsed = parseAttachedDirectoryLines(bad);
    assert.equal(parsed.ok, false, bad);
  }
});

test("a mention adds a mention recipient and guarantees @handle in the body", () => {
  assert.deepEqual(buildMessagePost("hello", undefined), {
    ok: true,
    value: { body: "hello", recipients: [] },
  });
  assert.deepEqual(
    buildMessagePost("please check", {
      handle: "reviewer-abc",
      participantId: "instance-1",
    }),
    {
      ok: true,
      value: {
        body: "@reviewer-abc please check",
        recipients: [{ participantId: "instance-1", reason: "mention" }],
      },
    },
  );
  assert.deepEqual(
    buildMessagePost("ok @reviewer-abc", {
      handle: "reviewer-abc",
      participantId: "instance-1",
    }),
    {
      ok: true,
      value: {
        body: "ok @reviewer-abc",
        recipients: [{ participantId: "instance-1", reason: "mention" }],
      },
    },
  );
  assert.equal(buildMessagePost("   ", undefined).ok, false);
});

const inventory: LocalRuntimeInventoryResponse = {
  hostId: "host-fixture",
  restartRequiredToRescan: true,
  runtimes: [
    {
      agentBindings: [],
      available: true,
      configured: true,
      displayName: "Codex",
      executable: "codex",
      modelBindingDescriptors: [
        {
          capabilityClasses: [],
          evidence: "probed",
          modelBindingId: "binding-fixture",
          modelId: "gpt-fixture",
          provider: "openai",
          supportedReasoning: ["low", "high"],
          supportedServiceTiers: [],
        },
      ],
      resolvedExecutablePath: "/tmp/fixture/codex",
      runtimeOfferId: "offer-fixture",
      runtimeProfileId: "profile-fixture",
      source: "configured",
    },
    {
      agentBindings: [],
      available: false,
      configured: false,
      displayName: "Kimi",
      executable: "kimi",
      modelBindingDescriptors: [],
      source: "discovered",
    },
  ],
};

test("runtime and model choices come only from published Host offers and bindings", () => {
  const choices = runtimeChoices(inventory);
  assert.deepEqual(
    choices.map(({ runtimeOfferId }) => runtimeOfferId),
    ["offer-fixture"],
  );
  assert.deepEqual(choices[0]?.bindings, [
    {
      label: "gpt-fixture（binding-fixture）",
      modelBindingId: "binding-fixture",
      reasoning: ["low", "high"],
    },
  ]);
});

test("a Role configuration only accepts a published binding and one of its reasoning levels", () => {
  const form = {
    displayName: "Fixture Reviewer",
    handle: "fixture-reviewer",
    instructions: "FIXTURE ONLY",
    modelBindingId: "binding-fixture",
    reasoning: "low",
    role: "reviewer",
    runtimeOfferId: "offer-fixture",
  };
  const choices = runtimeChoices(inventory);
  assert.deepEqual(buildRoleConfiguration(form, choices), {
    ok: true,
    value: {
      displayName: "Fixture Reviewer",
      handle: "fixture-reviewer",
      instructions: "FIXTURE ONLY",
      modelIntent: {
        exactBindingIds: ["binding-fixture"],
        fallback: "disabled",
        reasoning: "low",
      },
      role: "reviewer",
      runtimeOfferId: "offer-fixture",
    },
  });
  for (const bad of [
    { runtimeOfferId: "offer-guessed" },
    { modelBindingId: "binding-guessed" },
    { reasoning: "xhigh" },
    { handle: "bad handle" },
    { instructions: " " },
  ]) {
    assert.equal(
      buildRoleConfiguration({ ...form, ...bad }, choices).ok,
      false,
      JSON.stringify(bad),
    );
  }
});

test("removal refused for active collaboration work carries a cleanup hint", () => {
  const hint = activeWorkHint(
    new RahClientError(
      "conflict",
      "principal x has active collaboration work in Room y",
      409,
    ),
  );
  assert.match(hint ?? "", /急停/u);
  assert.equal(activeWorkHint(new Error("other")), null);
});

const settings: RuntimeSettings = {
  maxConcurrentRuns: 4,
  maxConcurrentStarts: 2,
  minStartIntervalMs: 0,
  revision: 7,
  runtimes: [
    {
      maxConcurrentRuns: 2,
      offerMaxConcurrent: 4,
      runtimeOfferId: "offer-fixture",
      runtimeProfileId: "profile-fixture",
    },
  ],
  wakeGuard: { instanceChainLimit: 10 },
  watchdog: {
    maxRunMs: 14_400_000,
    noProgressWarnMs: 900_000,
    queuedStallTerminateMs: 900_000,
  },
};

const settingsForm = {
  maxConcurrentRuns: "4",
  maxConcurrentStarts: "2",
  maxRunMinutes: "240",
  minStartIntervalMs: "0",
  noProgressWarnMinutes: "15",
  queuedStallTerminateMinutes: "15",
  runtimes: { "profile-fixture": "2" },
  wakeChainLimit: "10",
};

test("a settings update sends only changed fields with the revision it was based on", () => {
  assert.deepEqual(
    buildSettingsUpdate(settings, {
      ...settingsForm,
      noProgressWarnMinutes: "20",
      runtimes: { "profile-fixture": "3" },
      wakeChainLimit: "3",
    }),
    {
      ok: true,
      value: {
        expectedRevision: 7,
        runtimes: [
          { maxConcurrentRuns: 3, runtimeProfileId: "profile-fixture" },
        ],
        wakeGuard: { instanceChainLimit: 3 },
        watchdog: { noProgressWarnMs: 1_200_000 },
      },
    },
  );
  assert.equal(buildSettingsUpdate(settings, settingsForm).ok, false);
  for (const bad of [
    { wakeChainLimit: "0" },
    { maxConcurrentRuns: "65" },
    { noProgressWarnMinutes: "0.5" },
    { maxConcurrentStarts: "two" },
  ]) {
    assert.equal(
      buildSettingsUpdate(settings, { ...settingsForm, ...bad }).ok,
      false,
      JSON.stringify(bad),
    );
  }
  assert.equal(
    isSettingsConflict(
      new RahClientError(
        "conflict",
        "Runtime settings revision changed; reload settings",
        409,
      ),
    ),
    true,
  );
  assert.equal(
    isSettingsConflict(new RahClientError("invalid", "bad", 400)),
    false,
  );
});

function event(roomSeq: number, type: string, payload = {}): RoomEvent {
  return {
    actorId: "principal-human-fixture",
    aggregateId: "aggregate-fixture",
    aggregateType: "room",
    createdAt: NOW,
    eventId: `event-${String(roomSeq)}`,
    idempotencyKey: `key-${String(roomSeq)}`,
    payload,
    roomId: "room-a",
    roomSeq,
    schemaVersion: 1,
    type,
  };
}

test("SOS state and lifecycle events come from the synced Room events", () => {
  assert.equal(sosState([]).kind, "unknown");
  assert.equal(
    sosState([event(1, "message.posted"), event(2, "room.agent_sos_requested")])
      .kind,
    "stopping",
  );
  assert.equal(
    sosState([
      event(2, "room.agent_sos_requested"),
      event(3, "room.agent_sos_stopped"),
    ]).kind,
    "stopped",
  );
  assert.equal(
    sosState([
      event(3, "room.agent_sos_stopped"),
      event(4, "room.agent_sos_resumed"),
    ]).kind,
    "running",
  );
  const lifecycle = lifecycleEvents([
    event(1, "message.posted"),
    event(2, "instance.created"),
    event(3, "instance.session_reset", { sessionGeneration: 2 }),
    event(4, "membership.removed"),
  ]);
  assert.deepEqual(
    lifecycle.map(({ roomSeq, type }) => [roomSeq, type]),
    [
      [4, "membership.removed"],
      [3, "instance.session_reset"],
      [2, "instance.created"],
    ],
  );
  assert.match(lifecycle[1]!.label, /session/u);
});
