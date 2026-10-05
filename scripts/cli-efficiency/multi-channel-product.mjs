// Isolated Codex gate only. Scheduling is Human-authored test input, never a
// replacement product queue. Observe all Channel attempts, including failures.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { RoomKernel } from "@rah-os/kernel";
import { prepareGateDaemon } from "./gate-daemon.mjs";
import { measure, wait, transcript } from "./common.mjs";
import { runSucceeded } from "./warm.mjs";
import { recoverFailedProductRound } from "./long-session-recovery.mjs";

// The Role schema requires nonempty instructions. Keep only a reference here;
// the shared workspace AGENTS.md is the sole business-prose carrier.
export const MULTI_INSTRUCTION_POLICY = Object.freeze({
  id: "workspace-agents-business-only/v2",
  businessCarrier: "workspace/AGENTS.md in both arms",
  roleInstructions: "Follow the workspace AGENTS.md.",
  roleReferenceCost: "retained in product raw usage",
});

// Read-only durable inventory. No credential/lease tables or provider text are
// queried. Explicit joins include every participant's usage, not only speaker.
export function readMultiEvidence({ stateDirectory, observer, actor, roomId }) {
  const messages = [];
  let afterSeq = 0;
  for (;;) {
    const page = observer.listMessages(actor, { roomId, afterSeq, limit: 500 });
    messages.push(...page.messages);
    if (!page.hasMoreAfter) break;
    assert.ok(
      page.cursorAfter > afterSeq,
      "Message pagination did not advance",
    );
    afterSeq = page.cursorAfter;
  }
  const db = new DatabaseSync(join(stateDirectory, "room.db"), {
    readOnly: true,
  });
  try {
    const rows = (sql) =>
      db
        .prepare(sql)
        .all(roomId)
        .map((r) => ({ ...r }));
    return {
      messages,
      runs: observer.listRunAttempts({ roomId }),
      activations: observer.listActivations({ roomId }),
      subscriptionCursors: rows(
        "SELECT * FROM subscription_cursors WHERE room_id=?",
      ),
      events: rows(
        "SELECT event_id, room_id, room_seq, actor_id, type, aggregate_type, aggregate_id, payload_json FROM room_events WHERE room_id=?",
      ),
      presentedWindows: rows(
        "SELECT p.activation_id, p.consumer_id, p.run_attempt_id, p.from_seq, p.to_seq, p.presented_seqs_json, p.content_digest, p.rendered_at, p.sent_at, p.pending_ack_seq FROM activation_presented_windows p JOIN run_attempts r ON r.run_attempt_id=p.run_attempt_id WHERE r.room_id=?",
      ),
      markers: rows(
        "SELECT f.* FROM run_attempt_final_replies f JOIN run_attempts r ON r.run_attempt_id=f.run_attempt_id WHERE r.room_id=?",
      ),
      usageRows: rows(
        "SELECT u.* FROM run_attempt_usage u JOIN run_attempts r ON r.run_attempt_id=u.run_attempt_id WHERE r.room_id=?",
      ),
      usageGaps: rows(
        "SELECT u.* FROM run_attempt_usage_gaps u JOIN run_attempts r ON r.run_attempt_id=u.run_attempt_id WHERE r.room_id=?",
      ),
      runtimes: rows(
        "SELECT instance_runtime_id, participant_id, native_session_id, state, turn_count, started_at, terminated_reason FROM instance_runtimes WHERE participant_id IN (SELECT principal_id FROM memberships WHERE room_id=?)",
      ),
    };
  } finally {
    db.close();
  }
}

// Dependency seam is for deterministic tests; production callers use defaults.
export async function runMultiProduct(
  {
    root,
    cwd,
    config,
    steps,
    arm,
    save,
    beforeRound,
    productArm = "final-output",
    maxRunAttempts = steps.length,
  },
  dependencies = {},
) {
  assert.ok(
    ["final-output", "worker-mcp", "worker-delivery"].includes(productArm),
    "Unknown product arm",
  );
  assert.equal(config?.provider, "codex", "Multi product gate is Codex-only");
  assert.ok(config.model && config.bindingId && config.effort);
  assert.ok(Array.isArray(steps) && steps.length > 0);
  for (const s of steps) {
    assert.ok(["a", "b", "c"].includes(s.speaker));
    assert.ok(
      typeof s.body === "string" && s.body.trim() && !s.body.includes("@"),
      "Business question must not contain mentions",
    );
  }
  const deps = {
    prepareGateDaemon,
    RoomKernel,
    measure,
    transcript,
    wait,
    readEvidence: readMultiEvidence,
    ...dependencies,
  };
  const business = productArm === "worker-delivery";
  assert.ok(
    Number.isSafeInteger(maxRunAttempts) && maxRunAttempts >= steps.length,
  );
  assert.ok(
    business || maxRunAttempts === steps.length,
    "Legacy Run bound must not change",
  );
  arm.rounds ??= [];
  arm.processes ??= [];
  assert.equal(
    arm.rounds.length,
    0,
    "Do not resume a partially admitted experiment",
  );
  arm.members = {};
  arm.status = "running";
  arm.runLimit = maxRunAttempts;
  const gate = await deps.prepareGateDaemon({
    ...config,
    root,
    cwd,
    warm: true,
    prewarm: false,
    processes: arm.processes,
    save,
    consumerId: "multi-efficiency-gate",
  });
  let observer, actor, roomId, activeRound;
  const capture = () => {
    const data = deps.readEvidence({
      stateDirectory: gate.stateDirectory,
      observer,
      actor,
      roomId,
    });
    Object.assign(arm, data);
    if (business && activeRound) {
      const stageRuns = data.runs.filter(
        (r) => !activeRound.previousRunIds.includes(r.runAttemptId),
      );
      const ids = new Set(stageRuns.map((r) => r.runAttemptId));
      const activationIds = new Set(stageRuns.map((r) => r.activationId));
      activeRound.durableDeliveryProof = {
        runs: stageRuns,
        activations: data.activations.filter((a) =>
          activationIds.has(a.activationId),
        ),
        presentedWindows: (data.presentedWindows ?? []).filter((p) =>
          ids.has(p.run_attempt_id),
        ),
        subscriptionCursors: (data.subscriptionCursors ?? []).filter(
          (c) =>
            c.room_id === roomId &&
            c.participant_id === activeRound.participantId,
        ),
        finalMarkers: data.markers.filter((m) => ids.has(m.run_attempt_id)),
        messages: data.messages.filter(
          (m) =>
            m.roomSeq > activeRound.beforeRoomSeq &&
            m.actorId !== actor.principalId,
        ),
        events: (data.events ?? []).filter(
          (e) => e.room_seq > activeRound.beforeRoomSeq,
        ),
      };
    }
    save();
    return data;
  };
  const checkRuns = (data, round) => {
    assert.ok(data.runs.length <= maxRunAttempts, "Total Run limit exceeded");
    const fresh = data.runs.filter(
      (r) => !round.previousRunIds.includes(r.runAttemptId),
    );
    round.runs = fresh;
    assert.ok(
      (business || fresh.length <= 1) &&
        fresh.every((r) => r.participantId === round.participantId) &&
        (!business ||
          fresh.every(
            (r) => r.activationId && r.activationId === fresh[0].activationId,
          )),
      "Unexpected Run or automatic retry; no further admission",
    );
    return fresh;
  };
  try {
    await gate.start();
    observer = new deps.RoomKernel({
      databasePath: join(gate.stateDirectory, "room.db"),
    });
    observer.initialize();
    actor = observer.authenticateHumanAccessToken(
      gate.prepared.humanAccessToken,
    );
    const inventory = await gate.post("/v1/local/runtimes/list", {});
    const runtime = inventory.runtimes.find(
      (r) => r.runtimeProfileId === gate.spec.runtimeProfileId,
    );
    assert.ok(runtime?.runtimeOfferId);
    await deps.wait(
      () => observer.runtimeOfferIsCurrentlyAvailable(runtime.runtimeOfferId),
      60000,
    );
    const binding = runtime.modelBindingDescriptors.find(
      (b) => b.modelBindingId === config.bindingId,
    );
    assert.equal(binding?.modelId, config.model);
    assert.ok(binding.supportedReasoning.includes(config.effort));
    arm.binding = config.bindingId;
    const control = gate.prepared.metadata.controlRoomId;
    roomId = (
      await gate.post("/v3/client/rooms/create", {
        workspaceId: gate.prepared.metadata.workspaceId,
        basedOnControlRoomSeq: await gate.head(control),
        kind: "channel",
        name: "Isolated multi-instance gate",
        slug: "multi-efficiency",
        idempotencyKey: randomUUID(),
      })
    ).room.roomId;
    arm.roomId = roomId;
    for (const speaker of ["a", "b", "c"]) {
      const role = (
        await gate.post("/v3/client/roles/create", {
          controlRoomId: control,
          basedOnRoomSeq: await gate.head(control),
          idempotencyKey: randomUUID(),
          configuration: {
            displayName: `Multi ${speaker}`,
            handle: `multi-${speaker}`,
            instructions: MULTI_INSTRUCTION_POLICY.roleInstructions,
            role: "Bounded code reviewer",
            executionWorkspace: {
              kind: "existing_mount",
              workspaceMountRevisionId:
                gate.prepared.config.workspace.workspaceMountRevisionId,
            },
            runtimeOfferId: runtime.runtimeOfferId,
            modelIntent: {
              exactBindingIds: [config.bindingId],
              fallback: "disabled",
              reasoning: gate.spec.reasoning,
              serviceTier: "default",
            },
            toolAccessMode: "full_access",
          },
        })
      ).role;
      const created = await gate.post("/v3/client/roles/instantiate", {
        roleId: role.roleId,
        channelId: roomId,
        basedOnRoomSeq: await gate.head(roomId),
        idempotencyKey: randomUUID(),
      });
      assert.ok(
        typeof created.agent.handle === "string" &&
          created.agent.handle.length > 0,
        "Missing instance canonical handle",
      );
      arm.members[speaker] = {
        handle: created.agent.handle,
        participantId: created.instance.instanceId,
        agentId: created.agent.definition.agentId,
      };
    }
    assert.equal(
      new Set(Object.values(arm.members).map((m) => m.participantId)).size,
      3,
    );
    let data = capture();
    let settledRunIds = [];
    assert.equal(data.runs.length, 0, "Unexpected setup Run");
    for (const [index, step] of steps.entries()) {
      // Reinspect durable state after the caller's budget fence, before posting.
      await beforeRound?.({ round: index + 1, arm });
      data = capture();
      assert.deepEqual(
        data.runs.map((r) => r.runAttemptId).sort(),
        settledRunIds,
        "Unexpected Run between scheduled steps",
      );
      assert.ok(data.runs.length < maxRunAttempts, "No remaining Run budget");
      assert.ok(
        data.activations.every((a) => a.state === "completed"),
        "Channel not idle",
      );
      const member = arm.members[step.speaker];
      const round = {
        round: index + 1,
        speaker: step.speaker,
        participantId: member.participantId,
        startedAt: new Date().toISOString(),
        previousRunIds: data.runs.map((r) => r.runAttemptId),
        beforeRoomSeq: await gate.head(roomId),
      };
      activeRound = round;
      arm.rounds.push(round);
      save();
      const oldMessages = new Set(data.messages.map((m) => m.messageId));
      round.humanBody = `@${member.handle} ${step.body}`;
      await gate.post("/v3/client/messages/post", {
        roomId,
        basedOnRoomSeq: round.beforeRoomSeq,
        body: round.humanBody,
        idempotencyKey: randomUUID(),
        recipients: [
          { participantId: member.participantId, reason: "mention" },
        ],
      });
      await deps.wait(() => {
        data = capture();
        const fresh = checkRuns(data, round);
        const humanMessages = data.messages.filter(
          (m) =>
            !oldMessages.has(m.messageId) && m.actorId === actor.principalId,
        );
        assert.equal(
          humanMessages.length,
          1,
          "Expected one canonical mention Human message",
        );
        assert.deepEqual(
          humanMessages[0].mentions?.map((m) => ({
            principalId: m.principalId,
            handle: m.handle,
          })),
          [{ principalId: member.participantId, handle: member.handle }],
          "Human canonical mention did not bind exact scheduled instance",
        );
        round.humanMessageId = humanMessages[0].messageId;
        round.humanRoomSeq = humanMessages[0].roomSeq;
        round.replies = data.messages.filter(
          (m) =>
            !oldMessages.has(m.messageId) && m.actorId !== actor.principalId,
        );
        assert.ok(
          round.replies.length <= 1 &&
            round.replies.every(
              (m) =>
                m.actorId === member.participantId &&
                !m.threadId &&
                (!business || m.roomId === roomId),
            ),
          "Unexpected or duplicate Channel reply",
        );
        assert.ok(
          round.replies.every(
            (m) => !m.body.includes("@") && !m.mentions?.length,
          ),
          "Instance reply contains forbidden mention",
        );
        assert.ok(
          !data.activations.some((a) =>
            ["quarantined", "cancelled"].includes(a.state),
          ),
          "Activation failed",
        );
        if (
          !business &&
          fresh.some((r) =>
            ["failed", "cancelled", "timed_out"].includes(r.state),
          )
        )
          throw Error("Run failed");
        if (
          business &&
          fresh.length &&
          fresh.every((r) =>
            ["exited", "failed", "cancelled", "timed_out"].includes(r.state),
          ) &&
          data.activations.every((a) => a.state === "completed") &&
          data.runtimes.every((r) => r.state !== "busy") &&
          !round.replies.length
        )
          throw Error(
            "No canonical reply after terminal delivery; no further admission",
          );
        return (
          fresh.length >= 1 &&
          fresh.every((r) =>
            business
              ? ["exited", "failed", "cancelled", "timed_out"].includes(r.state)
              : r.state === "exited",
          ) &&
          round.replies.length === 1 &&
          data.activations.every((a) => a.state === "completed") &&
          data.runtimes.every((r) => r.state !== "busy")
        );
      });
      round.finishedAt = new Date().toISOString();
      const reply = round.replies[0];
      assert.ok(
        business
          ? typeof reply.body === "string" && !!reply.body.trim()
          : /^审查结论：\s*\S/.test(reply.body.trim()),
        "No effective answer",
      );
      round.answer = reply.body;
      round.replySeconds =
        (Date.parse(reply.createdAt) - Date.parse(round.startedAt)) / 1000;
      round.firstMessageSeconds = round.replySeconds;
      const attemptUsages = [];
      for (const attempt of round.runs) {
        const value = await gate.post("/v3/client/agents/run-usage/get", {
          agentId: member.agentId,
          runAttemptId: attempt.runAttemptId,
        });
        attemptUsages.push(value);
        round.attemptUsages = attemptUsages;
        assert.equal(value.completeness, "complete");
        assert.deepEqual(value.gaps, []);
        assert.ok(!value.truncated);
        const rt = data.runtimes.find(
          (r) => r.instance_runtime_id === value.execution?.instanceRuntimeId,
        );
        assert.ok(rt?.native_session_id, "Missing runtime session evidence");
        if (member.sessionId)
          assert.equal(
            rt.native_session_id,
            member.sessionId,
            "Session changed",
          );
        if (member.instanceRuntimeId)
          assert.equal(
            rt.instance_runtime_id,
            member.instanceRuntimeId,
            "Runtime changed",
          );
        member.sessionId = rt.native_session_id;
        member.instanceRuntimeId = rt.instance_runtime_id;
      }
      const markers = data.markers.filter(
        (m) =>
          round.runs.some((r) => r.runAttemptId === m.run_attempt_id) &&
          m.room_seq === reply.roomSeq &&
          (business ||
            m.submission_kind ===
              (productArm === "worker-mcp" ? null : "final-output")),
      );
      if (business)
        assert.equal(markers.length, 1, "Missing unique final marker");
      const run = business
        ? round.runs.find((r) => r.runAttemptId === markers[0].run_attempt_id)
        : round.runs[0];
      const finalUsage = attemptUsages[round.runs.indexOf(run)];
      assert.ok(
        runSucceeded(run, finalUsage.execution),
        "Unsuccessful final Run",
      );
      const usage = business
        ? {
            completeness: "complete",
            gaps: [],
            totals: Object.fromEntries(
              [
                "inputTokens",
                "cachedInputTokens",
                "outputTokens",
                "generations",
              ].map((field) => [
                field,
                attemptUsages.reduce((sum, u) => {
                  assert.ok(
                    Number.isSafeInteger(u.totals?.[field]) &&
                      u.totals[field] >= 0,
                    `Missing attempt usage: ${field}`,
                  );
                  return sum + u.totals[field];
                }, 0),
              ]),
            ),
            execution: finalUsage.execution,
            finalInterrupt: finalUsage.finalInterrupt,
          }
        : finalUsage;
      if (business)
        usage.totals.reasoningOutputTokens = attemptUsages.every(
          (u) =>
            Number.isSafeInteger(u.totals.reasoningOutputTokens) &&
            u.totals.reasoningOutputTokens >= 0,
        )
          ? attemptUsages.reduce(
              (sum, u) => sum + u.totals.reasoningOutputTokens,
              0,
            )
          : null;
      round.productUsage = usage;
      round.execution = usage.execution;
      round.sessionId = member.sessionId;
      if (business) {
        const proof = round.durableDeliveryProof,
          marker = markers[0];
        assert.equal(proof.finalMarkers.length, 1, "Multiple final markers");
        const activation = proof.activations.find(
          (a) => a.activationId === run.activationId,
        );
        assert.ok(
          activation &&
            activation.state === "completed" &&
            activation.participantId === member.participantId &&
            activation.roomId === roomId &&
            activation.toSeq >= round.humanRoomSeq,
          "Invalid delivery activation",
        );
        assert.equal(
          marker.activation_id,
          activation.activationId,
          "Marker activation mismatch",
        );
        assert.equal(marker.room_id, roomId, "Marker room mismatch");
        const event = proof.events.find((e) => e.event_id === marker.event_id);
        assert.ok(
          event &&
            event.room_id === roomId &&
            event.room_seq === reply.roomSeq &&
            event.actor_id === member.participantId &&
            event.type === "message.posted" &&
            event.aggregate_id === reply.messageId,
          "Canonical reply event mismatch",
        );
        const windows = proof.presentedWindows.filter(
          (p) =>
            p.run_attempt_id === run.runAttemptId &&
            p.activation_id === activation.activationId &&
            p.sent_at &&
            p.to_seq >= activation.toSeq,
        );
        assert.ok(
          windows.some((p) =>
            proof.subscriptionCursors.some(
              (c) =>
                c.consumer_id === p.consumer_id &&
                c.last_seq >= activation.toSeq,
            ),
          ),
          "Missing same-consumer delivery ACK cursor",
        );
      }
      const metas = deps
        .transcript(round.sessionId)
        .filter((e) => e.type === "session_meta");
      round.actualMemoryOff =
        metas.length > 0 &&
        metas.every((e) => e.payload.memory_mode === "disabled");
      assert.ok(round.actualMemoryOff, "Actual native memory is not disabled");
      round.metrics = deps.measure(
        round.sessionId,
        round,
        { replyAt: reply.createdAt },
        config,
        { turns: round.runs.length },
      );
      // measure() independently validates the original turn_context model/effort.
      round.actualIdentityVerified = true;
      round.actualModel = config.model;
      round.actualEffort = config.effort;
      round.metrics.productUsage = {
        completeness: usage.completeness,
        gaps: usage.gaps,
        totals: usage.totals,
      };
      for (const [field, value] of [
        ["inputTokens", round.metrics.input],
        ["cachedInputTokens", round.metrics.cached],
        ["outputTokens", round.metrics.output],
        [
          "generations",
          round.metrics.generationsTotal ?? round.metrics.generations,
        ],
      ]) {
        assert.ok(
          Number.isSafeInteger(value) && value >= 0,
          `Missing measured usage: ${field}`,
        );
        assert.equal(
          value,
          usage.totals?.[field],
          `Product/transcript usage mismatch: ${field}`,
        );
      }
      round.metrics.finalInterrupt = usage.finalInterrupt ?? null;
      round.metrics.replyAt = reply.createdAt;
      assert.equal(markers.length, 1, "Missing unique final marker");
      // Null submission kind is tool delivery, not by itself proof of MCP.
      round.finalMarker = markers[0];
      for (const p of observer.listPlacements({ roomId })) {
        assert.equal(p.resolvedModel.modelId, config.model);
        assert.equal(p.resolvedModel.reasoning, config.effort);
      }
      gate.assertNoGuardViolations();
      assert.deepEqual(observer.listTasks(actor, { roomId }), []);
      round.longStageSucceeded = true;
      save();
      settledRunIds = data.runs.map((r) => r.runAttemptId).sort();
      activeRound = undefined;
    }
    arm.status = "complete";
  } catch (error) {
    arm.status = "failed";
    arm.error = String(error);
    throw error;
  } finally {
    try {
      const exit = await gate.stop();
      if (exit) assert.equal(exit.code, 0, "Gate stop failed");
    } catch (error) {
      arm.status = "failed";
      arm.shutdownError = String(error);
      throw error;
    } finally {
      if (observer && roomId) {
        try {
          capture();
          if (activeRound) {
            const capturedAfterStop = new Date().toISOString();
            activeRound.finishedAt ??= capturedAfterStop;
            activeRound.failedUsageCapturedAt = capturedAfterStop;
            activeRound.runs = arm.runs.filter(
              (r) => !activeRound.previousRunIds.includes(r.runAttemptId),
            );
            // Recovery is per participant so unexpected peers are never omitted.
            activeRound.failedUsageByParticipant = Object.values(
              arm.members,
            ).map((m) => ({
              participantId: m.participantId,
              ...recoverFailedProductRound({
                stateDirectory: gate.stateDirectory,
                roomId,
                participantId: m.participantId,
                round: {
                  ...activeRound,
                  metrics: undefined,
                  finishedAt: capturedAfterStop,
                },
              }),
            }));
          }
          if (arm.status === "complete") {
            assert.deepEqual(
              arm.runs.map((r) => r.runAttemptId).sort(),
              arm.rounds
                .flatMap((r) => r.runs.map((a) => a.runAttemptId))
                .sort(),
              "Late unexpected Run",
            );
            assert.deepEqual(arm.usageGaps, [], "Late usage gap");
            for (const round of arm.rounds) {
              const rows = arm.usageRows.filter((u) =>
                round.runs.some((r) => r.runAttemptId === u.run_attempt_id),
              );
              assert.equal(
                rows.length,
                round.productUsage.totals.generations,
                "Late usage generation mismatch",
              );
              for (const [column, field] of [
                ["input_tokens", "inputTokens"],
                ["cached_input_tokens", "cachedInputTokens"],
                ["output_tokens", "outputTokens"],
              ]) {
                assert.equal(
                  rows.reduce((sum, r) => sum + r[column], 0),
                  round.productUsage.totals[field],
                  `Late usage mismatch: ${field}`,
                );
              }
            }
          }
        } catch (error) {
          arm.status = "failed";
          arm.evidenceError = String(error);
          throw error;
        } finally {
          observer.close();
          save();
        }
      } else {
        observer?.close();
        save();
      }
    }
  }
  return arm;
}
