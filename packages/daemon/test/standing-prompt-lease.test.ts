import assert from "node:assert/strict";
import test from "node:test";

import type { ActivationEnvelope } from "@rah-os/agent-host";
import type { AgentRuntimeContext } from "@rah-os/protocol";

import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";
import {
  DAEMON_VERSION,
  standingPromptLease,
} from "../src/standing-prompt-lease.ts";

function agentContext(input: {
  instructions?: string;
  role: string;
}): AgentRuntimeContext {
  return {
    agentDefinitionRevision: {
      agentId: "agent-definition-1",
      agentDefinitionRevisionId: "agent-revision-1",
      contentDigest: `sha256:${"1".repeat(64)}`,
      createdAt: "2026-08-30T09:00:00.000+08:00",
      createdBy: "human-owner",
      description: "Reviews changes and reports evidence.",
      displayName: "Claude Code",
      executionPolicyRevisionId: "execution-full-access-v1",
      ...(input.instructions === undefined
        ? {}
        : { instructions: input.instructions }),
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "memory-policy-1",
        contentDigest: `sha256:${"5".repeat(64)}`,
        versionId: "memory-policy-v1",
      },
      revision: 1,
      role: input.role,
      skillRefs: [],
    },
    handle: "claude",
    participantId: "participant-42",
    schemaVersion: 1,
  };
}

function envelope(agent?: AgentRuntimeContext): ActivationEnvelope {
  return {
    activationId: "activation-1",
    consumerId: "consumer-1",
    fromSeq: 1,
    hostId: "host-1",
    participantId: "participant-42",
    reason: "mention",
    roomId: "room-7",
    runAttemptId: "run-attempt-1",
    toSeq: 4,
    ...(agent === undefined ? {} : { agent }),
  };
}

const options = {
  toolAccessMode: "full_access",
  workspaceMode: "in_place",
  workspacePath: "/tmp/rah-workspace",
} as const;

test("the lease carries the compiled standing prompt for the activation agent", () => {
  const lease = standingPromptLease(
    envelope(
      agentContext({
        instructions: "Report only verified evidence.",
        role: "Claude Code Agent using the local account",
      }),
    ),
    options,
  );
  assert.ok(lease !== undefined);
  assert.equal(lease.args?.length, 2);
  assert.equal(lease.args?.[0], "--prompt");
  const prompt = lease.args![1]!;
  assert.match(prompt, /Claude Code Agent using the local account/u);
  assert.match(prompt, /Report only verified evidence\./u);
  assert.match(prompt, /## Current Runtime Context/u);
  assert.match(prompt, /- Workspace: \/tmp\/rah-workspace/u);
  assert.match(prompt, /- Room: room-7/u);
  assert.match(prompt, /- Host: host-1/u);
  assert.match(prompt, new RegExp(`- Daemon: v${DAEMON_VERSION}`, "u"));
  assert.equal(lease.env.RAH_STANDING_PROMPT_DIGEST, undefined);
});

test("the lease digest is the compiler's agent-only deterministic digest", () => {
  const agent = agentContext({
    instructions: "Report only verified evidence.",
    role: "Claude Code Agent using the local account",
  });
  const lease = standingPromptLease(envelope(agent), options)!;
  assert.equal(
    lease.standingPromptDigest,
    compileStandingPrompt({
      agent: {
        description: agent.agentDefinitionRevision.description!,
        displayName: agent.agentDefinitionRevision.displayName!,
        handle: agent.handle!,
        instructions: agent.agentDefinitionRevision.instructions!,
        participantId: agent.participantId,
        role: agent.agentDefinitionRevision.role,
      },
    }).deterministicDigest,
  );
  const otherRuntimeContext = standingPromptLease(envelope(agent), {
    ...options,
    workspacePath: "/tmp/other-workspace",
  })!;
  assert.equal(
    otherRuntimeContext.standingPromptDigest,
    lease.standingPromptDigest,
    "runtime context alone does not change the session-keying digest",
  );
  const editedRole = standingPromptLease(
    envelope(
      agentContext({
        instructions: "Report only verified evidence.",
        role: "Edited role",
      }),
    ),
    options,
  )!;
  assert.notEqual(editedRole.standingPromptDigest, lease.standingPromptDigest);
});

test("the lease reports the compiler version and digest as a diagnostic", () => {
  const lease = standingPromptLease(
    envelope(agentContext({ role: "Some role" })),
    options,
  )!;
  assert.equal(lease.diagnostics?.length, 1);
  assert.match(
    lease.diagnostics![0]!,
    new RegExp(
      `^\\[rah-os\\] standing prompt compiler v\\d+ digest ${lease.standingPromptDigest!}$`,
      "u",
    ),
  );
});

test("an activation without an Agent layer contributes no prompt", () => {
  assert.equal(standingPromptLease(envelope(), options), undefined);
});

test("a 64 KiB instructions body stays inside the runtime argument byte cap", () => {
  const lease = standingPromptLease(
    envelope(
      agentContext({
        instructions: "x".repeat(64 * 1_024),
        role: "Large instructions role",
      }),
    ),
    options,
  )!;
  const bytes = (lease.args ?? []).reduce(
    (total, argument) => total + Buffer.byteLength(argument),
    0,
  );
  assert.ok(bytes > 64 * 1_024, "the instructions are delivered verbatim");
  assert.ok(
    bytes < 256 * 1_024,
    `compiled standing prompt argv is ${String(bytes)} bytes`,
  );
});

test("delivery mode reaches the exact driver prompt and continuity digest", () => {
  const scope = envelope(agentContext({ role: "review" }));
  const wait = standingPromptLease(scope, { deliveryMode: "wait" })!;
  const direct = standingPromptLease(scope, { deliveryMode: "direct" })!;
  const gated = standingPromptLease(scope, { deliveryMode: "gated" })!;
  assert.match(direct.args!.join(" "), /Delivery mode at launch: direct/);
  assert.match(gated.args!.join(" "), /Delivery mode at launch: gated/);
  assert.notEqual(wait.standingPromptDigest, direct.standingPromptDigest);
  assert.notEqual(gated.standingPromptDigest, direct.standingPromptDigest);
});

test("Claude direct delivery can reuse only the same Agent's former gated prompt", () => {
  const scope = envelope(agentContext({ role: "review" }));
  const old = standingPromptLease(scope, { deliveryMode: "gated" })!;
  const next = standingPromptLease(scope, {
    deliveryMode: "direct",
    previousDeliveryMode: "gated",
  })!;
  assert.equal(next.compatibleStandingPromptDigest, old.standingPromptDigest);
  assert.notEqual(next.standingPromptDigest, old.standingPromptDigest);
  const changedRole = standingPromptLease(
    envelope(agentContext({ role: "different role" })),
    { deliveryMode: "direct", previousDeliveryMode: "gated" },
  )!;
  assert.notEqual(
    changedRole.compatibleStandingPromptDigest,
    old.standingPromptDigest,
  );
  assert.equal(
    standingPromptLease(scope, { deliveryMode: "direct" })!
      .compatibleStandingPromptDigest,
    undefined,
  );
});

test("channel Role instances require continuity; legacy agents keep their existing policy", () => {
  const agent = agentContext({ role: "Reviewer" });
  assert.equal(
    standingPromptLease(envelope(agent))?.env.RAH_REQUIRE_SESSION_CONTINUITY,
    "0",
  );
  assert.equal(
    standingPromptLease(envelope({ ...agent, instanceChannelId: "room-7" }))
      ?.env.RAH_REQUIRE_SESSION_CONTINUITY,
    "1",
  );
});

test("channel and instance private box retain the same provider session prompt key", () => {
  const agent = {
    ...agentContext({ instructions: "Review only.", role: "Reviewer" }),
    instanceChannelId: "channel",
  };
  const channel = standingPromptLease(
    { ...envelope(agent), roomId: "channel" },
    options,
  )!;
  const privateBox = standingPromptLease(
    { ...envelope(agent), roomId: "private-box" },
    options,
  )!;
  assert.equal(channel.standingPromptDigest, privateBox.standingPromptDigest);
  assert.equal(privateBox.env?.RAH_REQUIRE_SESSION_CONTINUITY, "1");
});

test("the lease names the protocol version the compiled prompt carries, independent of role", async () => {
  const { STANDING_PROTOCOL_VERSION, renderStandingProtocolCard } =
    await import("@rah-os/agent-host");
  const review = standingPromptLease(
    envelope(agentContext({ role: "review" })),
  )!;
  const other = standingPromptLease(
    envelope(agentContext({ role: "something else" })),
    { deliveryMode: "direct" },
  )!;
  assert.equal(review.standingProtocolVersion, STANDING_PROTOCOL_VERSION);
  assert.equal(other.standingProtocolVersion, STANDING_PROTOCOL_VERSION);
  assert.notEqual(review.standingPromptDigest, other.standingPromptDigest);
  // Every protocol section of the card is sent verbatim in the prompt, so the
  // version names exactly the rules a new session receives.
  const prompt = review.args!.join("\n");
  for (const section of renderStandingProtocolCard().split("\n\n").slice(1))
    assert.ok(prompt.includes(section), section.slice(0, 60));
});

test("a launch carrying the Loom Worker tools gets the tool protocol, its version and the lease marker", async () => {
  const {
    RAH_WORKER_TOOLS_ENV,
    STANDING_PROTOCOL_VERSION,
    renderStandingProtocolCard,
    standingProtocolVersion,
    workerToolNames,
  } = await import("@rah-os/agent-host");
  const names = workerToolNames("opencode")!;
  const agent = agentContext({ role: "review" });
  const cli = standingPromptLease(envelope(agent))!;
  const tools = standingPromptLease(envelope(agent), {
    workerTools: "opencode",
  })!;
  assert.equal(cli.env?.[RAH_WORKER_TOOLS_ENV], undefined);
  assert.equal(tools.env?.[RAH_WORKER_TOOLS_ENV], "opencode");
  assert.equal(cli.standingProtocolVersion, STANDING_PROTOCOL_VERSION);
  assert.equal(tools.standingProtocolVersion, standingProtocolVersion(names));
  assert.notEqual(tools.standingPromptDigest, cli.standingPromptDigest);
  const prompt = tools.args!.join("\n");
  for (const section of renderStandingProtocolCard(names)
    .split("\n\n")
    .slice(1))
    assert.ok(prompt.includes(section), section.slice(0, 60));
  assert.doesNotMatch(prompt, /RAH_MESSAGE_EOF/u);
  assert.match(prompt, /`loom_message_post`/u);
  // The startup bootstrap keeps its CLI form (the tools have no --startup).
  assert.match(prompt, /worker message-check --startup/u);
});
