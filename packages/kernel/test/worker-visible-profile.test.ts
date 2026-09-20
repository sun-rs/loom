import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { issueAuthenticatedWorkerExecutionContext } from "../src/auth.ts";
import { WorkerSelfProfileService } from "../src/worker-self-profile.ts";
import { WorkerReadService } from "../src/worker-read-tools.ts";
import { ProfileImageLifecycleService } from "../src/profile-image-lifecycle.ts";
import { RoomEventWriter } from "../src/room-event-writer.ts";
import { ActivationObligationService } from "../src/activation-obligation-service.ts";
import { inImmediateTransaction } from "../src/sqlite-transaction.ts";
function fixture(
  modelIntent: import("@rah-os/protocol").ModelIntent = {
    fallback: "disabled",
    exactBindingIds: ["model-current"],
    reasoning: "low",
  },
) {
  const dir = mkdtempSync(join(tmpdir(), "rah-worker-profile-")),
    path = join(dir, "room.db"),
    now = () => new Date("2026-09-08T00:00:00Z");
  const kernel = new RoomKernel({ databasePath: path, now });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" }),
    agent = kernel.provisionPrincipal({ handle: "alice", kind: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Profiles",
    slug: "profiles",
    idempotencyKey: "workspace",
  });
  const control = workspace.controlRoom.roomId;
  kernel.addMember(actor, {
    roomId: control,
    principalId: agent.principal.principalId,
  });
  const room = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    kind: "channel",
    name: "Work",
    slug: "work",
    visibility: "public",
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: control,
      consumerId: "head",
    }).latestRoomSeq,
    idempotencyKey: "room",
  });
  kernel.addMember(actor, {
    roomId: room.room.roomId,
    principalId: agent.principal.principalId,
  });
  const db = new DatabaseSync(path),
    head = () =>
      Number(
        db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(control)!.n,
      );
  const ref = {
    artifactId: "private-memory",
    versionId: "v1",
    contentDigest: `sha256:${"a".repeat(64)}`,
  };
  const policy = kernel.createExecutionPolicy(actor, {
    controlRoomId: control,
    basedOnRoomSeq: head(),
    idempotencyKey: "policy",
    modelIntent,
    preferred: [],
    required: {
      allowedOfferIds: ["offer"],
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "none",
      workspaceMode: "in_place",
    },
    retryPolicyRef: ref,
    sessionPolicy: "fresh",
    toolAccessMode: "full_access",
  });
  const definition = kernel.createAgentDefinition(actor, {
    controlRoomId: control,
    basedOnRoomSeq: head(),
    idempotencyKey: "definition",
    participantId: agent.principal.principalId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    role: "PRIVATE ROLE",
    instructions: "PRIVATE INSTRUCTIONS",
    displayName: "Alice",
    instructionRefs: [],
    skillRefs: [],
    memoryPolicyRef: ref,
  });
  const execution = issueAuthenticatedWorkerExecutionContext(
    "credential",
    "instance",
    {
      activationId: "activation",
      consumerId: "consumer",
      hostId: "host",
      participantId: agent.principal.principalId,
      roomId: room.room.roomId,
      runAttemptId: "run",
      toSeq: 2,
    },
  );
  let active = true;
  const createId = (prefix: string) => `${prefix}_${randomUUID()}`;
  const events = new RoomEventWriter({
    database: db,
    createId,
    now,
    obligations: new ActivationObligationService({ database: db, createId }),
  });
  const profiles = new WorkerSelfProfileService({
    database: db,
    createId,
    now,
    events,
    profileImages: new ProfileImageLifecycleService({
      database: db,
      now,
      createId,
      requireActor: (candidate) =>
        kernel.getAuthenticatedPrincipal(candidate).principalId,
    }),
    requireWorker: (candidate) => {
      if (!active || candidate !== execution)
        throw new Error("execution fenced");
      return candidate.scope;
    },
    transaction: (operation) => inImmediateTransaction(db, operation),
  });
  return {
    kernel,
    db,
    human,
    reads: new WorkerReadService({
      database: db,
      now,
      requireWorker: (candidate) => {
        if (!active || candidate !== execution) throw new Error("fenced");
        return candidate.scope;
      },
    }),
    profiles,
    execution,
    definition,
    actor,
    agentActor,
    agent,
    control,
    head,
    roomId: room.room.roomId,
    revoke() {
      active = false;
    },
    close() {
      db.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("visible profile exposes shared configured metadata, original creator and only visible created Agents without private configuration", () => {
  const f = fixture();
  try {
    const self = f.reads.profile(f.execution, {});
    assert.ok(self.configured);
    assert.equal(self.configured.reasoning, "low");
    assert.deepEqual(self.configured.modelBindingIds, ["model-current"]);
    assert.equal(self.configured.runtimeTargets[0]!.runtimeOfferId, "offer");
    assert.equal(self.configured.runtimeTargets[0]!.registered, false);
    assert.equal(self.creator!.participantId, f.human.principal.principalId);
    assert.equal(self.actualRun, null);
    assert.deepEqual(
      f.reads.members(f.execution, {}).members.find((p) => p.isSelf),
      self,
    );
    assert.deepEqual(
      f.reads.serverInfo(f.execution, {}).members.find((p) => p.isSelf),
      self,
    );
    const h = f.reads.profile(f.execution, {
      target: f.human.principal.principalId,
    });
    assert.equal(h.createdAgents!.length, 1);
    assert.equal(
      h.createdAgents![0]!.participantId,
      f.agent.principal.principalId,
    );
    const hidden = f.kernel.provisionPrincipal({
      kind: "agent",
      handle: "hidden-child",
    });
    f.kernel.addMember(f.actor, {
      roomId: f.control,
      principalId: hidden.principal.principalId,
    });
    f.kernel.createAgentDefinition(f.actor, {
      controlRoomId: f.control,
      basedOnRoomSeq: f.head(),
      idempotencyKey: "hidden-definition",
      participantId: hidden.principal.principalId,
      executionPolicyRevisionId:
        f.definition.revision.executionPolicyRevisionId,
      role: "PRIVATE HIDDEN ROLE",
      instructionRefs: [],
      skillRefs: [],
      memoryPolicyRef: f.definition.revision.memoryPolicyRef,
    });
    assert.equal(
      f.reads.profile(f.execution, { target: f.human.principal.principalId })
        .createdAgents!.length,
      1,
    );
    const payload = JSON.stringify(self);
    for (const secret of [
      "PRIVATE ROLE",
      "PRIVATE INSTRUCTIONS",
      "private-memory",
      "credential",
      "instance",
    ])
      assert.ok(!payload.includes(secret));
    f.profiles.update(f.execution, {
      writeContext: f.profiles.get(f.execution, {}).writeContext,
      idempotencyKey: "self-editor",
      patch: { description: "changed by Agent" },
    });
    assert.equal(
      f.reads.profile(f.execution, {}).creator!.participantId,
      f.human.principal.principalId,
    );
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.roomId, f.human.principal.principalId);
    assert.equal(f.reads.profile(f.execution, {}).creator, null);
  } finally {
    f.close();
  }
});

test("visible profile shows no invented runtime for legacy Agents and never reads a departed target", () => {
  const f = fixture();
  try {
    const legacy = f.kernel.provisionPrincipal({
      kind: "agent",
      handle: "legacy",
    });
    f.kernel.addMember(f.actor, {
      roomId: f.roomId,
      principalId: legacy.principal.principalId,
    });
    const profile = f.reads.profile(f.execution, { target: "legacy" });
    assert.equal(profile.configured, null);
    assert.equal(profile.creator, null);
    assert.equal(profile.actualRun, null);
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.roomId, legacy.principal.principalId);
    assert.throws(
      () => f.reads.profile(f.execution, { target: "legacy" }),
      /unavailable/,
    );
    f.revoke();
    assert.throws(() => f.reads.profile(f.execution, {}), /fenced/);
  } finally {
    f.close();
  }
});

test("visible profile separates configured offer/model from the frozen actual Run and omits another Room's execution", () => {
  const f = fixture();
  try {
    const stamp = "2026-09-08T00:00:00Z",
      later = "2026-09-08T00:01:00Z";
    f.db
      .prepare(
        "INSERT INTO agent_hosts(host_id,instance_id,participant_ids_json,state,created_at,last_seen_at,last_seen_ms,build_version) VALUES('host','instance',?,'online',?,?,0,'observed-host-v1')",
      )
      .run(JSON.stringify([f.agent.principal.principalId]), stamp, stamp);
    f.db
      .prepare(
        "INSERT INTO runtime_offers(runtime_offer_id,current_observation_id,current_snapshot_digest,host_id,host_instance_id,runtime_profile_id,runtime_profile_revision_id,revision_digest,state,observed_at,observed_at_ms,lease_until,lease_until_ms,accepted_at,offer_json,updated_at) VALUES('offer','observation','digest','host','instance','configured-runtime','configured-revision','digest','available',?,0,?,9999999999999,?,?,?)",
      )
      .run(
        stamp,
        later,
        stamp,
        JSON.stringify({
          protocolFamily: "rah-worker-process/v1",
          modelBindingDescriptors: [
            {
              modelBindingId: "model-current",
              provider: "provider",
              modelId: "current-model",
            },
          ],
          privateEnv: { TOKEN: "secret-never-visible" },
        }),
        stamp,
      );
    f.db
      .prepare(
        "INSERT INTO runtime_offer_observations(runtime_offer_observation_id,runtime_offer_id,observation_sequence,runtime_offer_snapshot_digest,host_id,host_instance_id,runtime_profile_revision_id,revision_digest,observed_at,observed_at_ms,accepted_at,accepted_at_ms,lease_until,lease_until_ms,report_json,projection_json) VALUES('observation','offer',1,'digest','host','instance','frozen-revision','digest',?,0,?,0,?,9999999999999,'{}','{}')",
      )
      .run(stamp, stamp, later);
    f.kernel.postMessage(f.actor, {
      roomId: f.roomId,
      body: "fixture-run-input",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "run-input",
    });
    const activation = f.db
      .prepare(
        "SELECT activation_id FROM activations WHERE room_id=? AND participant_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(f.roomId, f.agent.principal.principalId)!.activation_id!;
    const revision = f.definition.revision;
    // Authoritative placement fixture, independent of current offer projection. No private policy/argv is returned.
    f.db
      .prepare(
        "INSERT INTO placements(placement_id,activation_id,activation_attempt_number,room_id,participant_id,agent_definition_revision_id,execution_policy_revision_id,host_id,host_instance_id,runtime_offer_id,runtime_offer_observation_id,runtime_offer_snapshot_digest,runtime_profile_id,runtime_profile_revision_id,workspace_mount_revision_id,workspace_mode,state,lease_until,lease_until_ms,decision_json,created_at,updated_at) VALUES('placement',?,1,?,?,?,?,'host','instance','offer','observation','digest','frozen-runtime','frozen-revision','private-mount','in_place','consumed',?,9999999999999,?,?,?)",
      )
      .run(
        activation,
        f.roomId,
        f.agent.principal.principalId,
        revision.agentDefinitionRevisionId,
        revision.executionPolicyRevisionId,
        later,
        JSON.stringify({
          resolvedModel: {
            source: "explicit_binding",
            modelBindingId: "old-binding",
            provider: "provider",
            modelId: "frozen-model",
            reasoning: "medium",
          },
          privatePath: "/private/workspace",
        }),
        stamp,
        stamp,
      );
    f.db
      .prepare(
        "INSERT INTO run_attempts(run_attempt_id,placement_id,activation_id,room_id,participant_id,host_id,attempt_number,state,started_at) VALUES('visible-run','placement',?,?,?,'host',1,'running',?)",
      )
      .run(activation, f.roomId, f.agent.principal.principalId, stamp);
    const seen: string[] = [];
    const enriched = f.reads.profile(
      f.execution,
      {},
      {
        computer: (hostId: string) => ({
          hostId,
          displayName: "Named Computer",
          hostname: "test-host.local",
          os: "darwin arm64",
          description: "Local desktop",
          connection: {
            status: "online",
            observedAt: stamp,
            lastSeenAt: stamp,
            staleAfterMs: 30000,
          },
        }),
        runtime: (target: {
          hostId: string;
          runtimeProfileId: string;
          runtimeProfileRevisionId: string;
        }) => {
          seen.push(target.runtimeProfileRevisionId);
          return {
            ...target,
            cliId: "codex" as const,
            displayName: target.runtimeProfileRevisionId,
            executionMode: "byoc" as const,
          };
        },
      },
    );
    assert.equal(enriched.actualRun!.computer.displayName, "Named Computer");
    assert.equal(enriched.actualRun!.runtime!.displayName, "frozen-revision");
    assert.equal(
      enriched.configured!.runtimeTargets[0]!.runtime!.displayName,
      "configured-revision",
    );
    assert.ok(seen.includes("frozen-revision"));
    assert.ok(seen.includes("configured-revision"));
    const profile = f.reads.profile(f.execution, {});
    assert.equal(
      profile.configured!.runtimeTargets[0]!.models[0]!.modelId,
      "current-model",
    );
    assert.equal(
      profile.configured!.runtimeTargets[0]!.runtimeProfileId,
      "configured-runtime",
    );
    assert.equal(profile.configured!.reasoning, "low");
    assert.equal(profile.actualRun!.runtimeProfileId, "frozen-runtime");
    assert.equal(profile.actualRun!.model!.modelId, "frozen-model");
    assert.equal(profile.actualRun!.model!.reasoning, "medium");
    assert.equal(profile.actualRun!.computer.observedState, "online");
    assert.equal("state" in profile.actualRun!.computer, false);
    assert.equal(
      profile.actualRun!.computer.reportedBuildVersion,
      "observed-host-v1",
    );
    assert.ok(!JSON.stringify(profile).includes("secret-never-visible"));
    assert.ok(!JSON.stringify(profile).includes("/private"));
    const custom = {
      source: "custom_model",
      runtime: "claude",
      modelId: "claude-sonnet-5",
      reasoning: "high",
    };
    f.db
      .prepare(
        "UPDATE placements SET decision_json=? WHERE placement_id='placement'",
      )
      .run(JSON.stringify({ resolvedModel: custom }));
    const customRun = f.reads.profile(f.execution, {}).actualRun!;
    assert.deepEqual(customRun.model, {
      source: "custom_model",
      modelId: "claude-sonnet-5",
      reasoning: "high",
    });

    const hidden = f.kernel.createRoom(f.actor, {
      name: "Hidden",
      slug: "hidden",
    });
    f.kernel.addMember(f.actor, {
      roomId: hidden.roomId,
      principalId: f.agent.principal.principalId,
    });
    f.kernel.postMessage(f.actor, {
      roomId: hidden.roomId,
      body: "private",
      recipients: [
        { participantId: f.agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "hidden-input",
    });
    const hiddenActivation = f.db
      .prepare(
        "SELECT activation_id FROM activations WHERE room_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(hidden.roomId)!.activation_id!;
    f.db
      .prepare(
        "INSERT INTO run_attempts(run_attempt_id,activation_id,room_id,participant_id,host_id,attempt_number,state,started_at,finished_at) VALUES('hidden-run',?,?,?,'hidden-computer',1,'exited',?,?)",
      )
      .run(
        hiddenActivation,
        hidden.roomId,
        f.agent.principal.principalId,
        later,
        later,
      );
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(hidden.roomId, f.agent.principal.principalId);
    assert.equal(
      f.reads.profile(f.execution, {}).actualRun!.runAttemptId,
      "visible-run",
    );
    assert.ok(
      !JSON.stringify(f.reads.profile(f.execution, {})).includes(
        "hidden-computer",
      ),
    );
  } finally {
    f.close();
  }
});

test("server info retains its self runtime context when the member page does not include self", () => {
  const f = fixture();
  try {
    const page = f.reads.serverInfo(f.execution, { limit: 1 });
    assert.equal(page.members.length, 1);
    assert.equal(
      page.runtimeContext!.principal.principalId,
      f.agent.principal.principalId,
    );
    assert.equal(page.runtimeContext!.configured!.reasoning, "low");
  } finally {
    f.close();
  }
});

test("public profile reuses timestamp and time-aware presence owners without exposing diagnostic error text", () => {
  const f = fixture();
  try {
    const p = f.reads.profile(f.execution, {});
    assert.equal(p.createdAt, f.definition.definition.createdAt);
    assert.equal(p.deletedAt, null);
    assert.equal(p.availability!.activity, "offline");
    assert.equal(p.availability!.reason, "unknown");
    assert.equal(p.membership!.scope, "room");
    assert.equal(p.membership!.role, "member");
    const stamp = "2026-09-08T00:00:00Z",
      ms = Date.parse(stamp);
    f.db
      .prepare(
        "INSERT INTO agent_hosts(host_id,instance_id,participant_ids_json,state,created_at,last_seen_at,last_seen_ms) VALUES('presence-host','presence-instance',?,'online',?,?,?)",
      )
      .run(JSON.stringify([f.agent.principal.principalId]), stamp, stamp, ms);
    assert.equal(
      f.reads.profile(f.execution, {}).availability!.activity,
      "online",
    );
    f.db
      .prepare(
        "UPDATE agent_hosts SET last_seen_ms=? WHERE host_id='presence-host'",
      )
      .run(ms - 30001);
    assert.equal(
      f.reads.profile(f.execution, {}).availability!.reason,
      "host_offline",
    );
    assert.ok(
      !JSON.stringify(f.reads.profile(f.execution, {})).includes("PRIVATE"),
    );
  } finally {
    f.close();
  }
});

test("created Agent pages have continuations bound to the visible creator and include configured runtime facts", () => {
  const f = fixture();
  try {
    const add = (handle: string) => {
      const child = f.kernel.provisionPrincipal({ kind: "agent", handle });
      f.kernel.addMember(f.actor, {
        roomId: f.control,
        principalId: child.principal.principalId,
      });
      f.kernel.addMember(f.actor, {
        roomId: f.roomId,
        principalId: child.principal.principalId,
      });
      f.kernel.createAgentDefinition(f.actor, {
        controlRoomId: f.control,
        basedOnRoomSeq: f.head(),
        idempotencyKey: handle,
        participantId: child.principal.principalId,
        executionPolicyRevisionId:
          f.definition.revision.executionPolicyRevisionId,
        role: "PRIVATE",
        instructionRefs: [],
        skillRefs: [],
        memoryPolicyRef: f.definition.revision.memoryPolicyRef,
      });
      return child;
    };
    const second = add("second");
    const first = f.reads.profile(f.execution, {
      target: "human",
      createdAgentsLimit: 1,
    });
    assert.equal(first.createdAgents!.length, 1);
    assert.equal(
      first.createdAgents![0]!.participantId,
      second.principal.principalId,
    );
    assert.ok(first.createdAgentsNextCursor);
    assert.equal(first.createdAgentsTruncated, true);
    assert.deepEqual(first.createdAgents![0]!.runtimes, [
      { runtimeOfferId: "offer", registered: false },
    ]);
    add("late-child");
    const next = f.reads.profile(f.execution, {
      target: "human",
      createdAgentsLimit: 1,
      createdAgentsCursor: first.createdAgentsNextCursor!,
    });
    assert.equal(
      next.createdAgents![0]!.participantId,
      f.agent.principal.principalId,
    );
    assert.equal(next.createdAgentsNextCursor, undefined);
    assert.equal(next.createdAgentsTruncated, false);
    assert.throws(
      () =>
        f.reads.profile(f.execution, {
          createdAgentsCursor: first.createdAgentsNextCursor!,
        }),
      /cursor|scope/,
    );
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.roomId, f.human.principal.principalId);
    assert.throws(
      () =>
        f.reads.profile(f.execution, {
          target: "human",
          createdAgentsCursor: first.createdAgentsNextCursor!,
        }),
      /unavailable/,
    );
  } finally {
    f.close();
  }
});

test("large created-Agent metadata stays byte bounded and serverInfo remains readable with complete member continuations", () => {
  const f = fixture();
  try {
    for (let n = 0; n < 40; n++) {
      const child = f.kernel.provisionPrincipal({
        kind: "agent",
        handle: `child-${n}`,
      });
      f.kernel.addMember(f.actor, {
        roomId: f.control,
        principalId: child.principal.principalId,
      });
      f.kernel.addMember(f.actor, {
        roomId: f.roomId,
        principalId: child.principal.principalId,
      });
      f.kernel.createAgentDefinition(f.actor, {
        controlRoomId: f.control,
        basedOnRoomSeq: f.head(),
        idempotencyKey: `child-${n}`,
        participantId: child.principal.principalId,
        executionPolicyRevisionId:
          f.definition.revision.executionPolicyRevisionId,
        role: "PRIVATE",
        instructionRefs: [],
        skillRefs: [],
        memoryPolicyRef: f.definition.revision.memoryPolicyRef,
      });
    }
    // Seed the worst legal published metadata shape; these reads do not execute fake offers.
    f.db
      .prepare("UPDATE agent_definition_revisions SET created_by=?")
      .run(f.agent.principal.principalId);
    const ids = Array.from(
        { length: 16 },
        (_, i) => `offer-${i}-${"x".repeat(100)}`,
      ),
      stamp = "2026-09-08T00:00:00Z";
    f.db
      .prepare(
        "UPDATE execution_policy_revisions SET policy_json=json_set(policy_json,'$.required.allowedOfferIds',json(?))",
      )
      .run(JSON.stringify(ids));
    for (const id of ids)
      f.db
        .prepare(
          "INSERT INTO runtime_offers(runtime_offer_id,current_observation_id,current_snapshot_digest,host_id,host_instance_id,runtime_profile_id,runtime_profile_revision_id,revision_digest,state,observed_at,observed_at_ms,lease_until,lease_until_ms,accepted_at,offer_json,updated_at) VALUES(?,?,'digest','host','instance',?,?,'digest','available',?,0,?,9999999999999,?,'{}',?)",
        )
        .run(
          id,
          `obs-${id}`,
          `profile-${id}`,
          `revision-${id}`,
          stamp,
          stamp,
          stamp,
          stamp,
        );
    const metadata = {
      computer: () => undefined,
      runtime: (target: {
        hostId: string;
        runtimeProfileId: string;
        runtimeProfileRevisionId: string;
      }) => ({
        ...target,
        displayName: "\u0000".repeat(256),
        executionMode: "byoc" as const,
      }),
    };
    const profile = f.reads.profile(f.execution, {}, metadata);
    assert.ok(profile.createdAgentsNextCursor);
    assert.ok(Buffer.byteLength(JSON.stringify(profile)) <= 384 * 1024);
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = f.reads.serverInfo(
        f.execution,
        cursor ? { cursor } : {},
        metadata,
      );
      assert.ok(
        Buffer.byteLength(JSON.stringify(page)) < 512 * 1024,
        "serverInfo must fit ordinary CLI read transport",
      );
      for (const member of page.members) {
        assert.ok(!seen.has(member.principal.principalId));
        seen.add(member.principal.principalId);
      }
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(seen.size, 42);
  } finally {
    f.close();
  }
});

test("persisted custom Claude effort is visible to the Agent without a fabricated binding", () => {
  const f = fixture({
    customModel: { runtime: "claude", modelId: "claude-sonnet-5" },
    reasoning: "high",
    fallback: "disabled",
  });
  try {
    const configured = f.reads.profile(f.execution, {}).configured!;
    assert.equal(configured.reasoning, "high");
    assert.equal(configured.customModelId, "claude-sonnet-5");
    assert.equal(configured.modelSelection, "custom_model");
    assert.deepEqual(configured.modelBindingIds, []);
  } finally {
    f.close();
  }
});
