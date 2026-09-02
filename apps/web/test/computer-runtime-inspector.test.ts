import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocalComputerObservation,
  LocalRuntimeInventoryEntry,
} from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  localComputerDiagnosticText,
  runtimeInspectorRows,
  RAFT_RUNTIME_INSPECTOR_CLOSE_DELAY_MS,
  RAFT_RUNTIME_INSPECTOR_OPEN_DELAY_MS,
  RAFT_RUNTIME_INSPECTOR_WIDTH,
} from "../src/computer-runtime-inspector-model.ts";

const runtime = {
  agentBindings: [
    {
      agentDefinitionId: "agent-a",
      handle: "alice",
      participantId: "participant-a",
    },
  ],
  available: true,
  configured: true,
  displayName: "Codex",
  executable: "codex",
  modelBindingDescriptors: [
    {
      capabilityClasses: ["deep_coding" as const],
      evidence: "probed" as const,
      modelBindingId: "binding-a",
      modelId: "gpt-test",
      provider: "openai",
      supportedServiceTiers: ["default" as const],
      supportedReasoning: ["low" as const],
    },
  ],
  resolvedExecutablePath: "/opt/local/bin/codex",
  runtimeOfferId: "offer-a",
  runtimeProfileId: "profile-a",
  runtimeProfileRevisionId: "profile-revision-a",
  source: "configured" as const,
  version: "1.2.3",
} satisfies LocalRuntimeInventoryEntry;

const computer = {
  displayName: "Mac-Studio",
  hostname: "Mac-Studio.local",
  os: "darwin arm64",
  status: "online" as const,
  observedAt: "2026-09-02T00:00:00.000Z",
  lastSeenAt: "2026-09-02T00:00:00.000Z",
  staleAfterMs: 30_000,
} satisfies LocalComputerObservation;

const agent = {
  agentDefinitionId: "agent-a",
  createdAt: "2026-09-02T00:00:00.000Z",
  createdBy: "human-a",
  displayName: "Alice",
  executionPolicyRevisionId: "policy-a",
  handle: "alice",
  participantId: "participant-a",
  role: "developer",
  runtimeAvailable: true,
  runtimeLabels: ["Codex"],
  skillRefs: [],
  state: "enabled" as const,
} satisfies WorkspaceAgentView;

const unrelatedAgent = {
  ...agent,
  agentDefinitionId: "agent-b",
  displayName: "Bob",
  handle: "bob",
  participantId: "participant-b",
} satisfies WorkspaceAgentView;

test("Runtime inspector keeps Raft's timing and desktop width", () => {
  assert.equal(RAFT_RUNTIME_INSPECTOR_OPEN_DELAY_MS, 200);
  assert.equal(RAFT_RUNTIME_INSPECTOR_CLOSE_DELAY_MS, 160);
  assert.equal(RAFT_RUNTIME_INSPECTOR_WIDTH, 390);
});

test("Runtime inspector projects only existing local probe evidence", () => {
  assert.deepEqual(runtimeInspectorRows(runtime), [
    { label: "版本", value: "1.2.3" },
    { label: "可执行文件", value: "/opt/local/bin/codex" },
    { label: "Runtime Profile", value: "profile-a" },
    { label: "Offer", value: "offer-a" },
    { label: "已验证模型", value: "1" },
    { label: "绑定 Agent", value: "1" },
  ]);
});

test("Computer diagnostics are bounded, credential-free canonical observations", () => {
  const text = localComputerDiagnosticText({
    agents: [agent, unrelatedAgent],
    computer,
    hostId: "host-a",
    runtimes: [runtime],
  });
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed, {
    computer: {
      displayName: "Mac-Studio",
      hostname: "Mac-Studio.local",
      lastSeenAt: "2026-09-02T00:00:00.000Z",
      observedAt: "2026-09-02T00:00:00.000Z",
      os: "darwin arm64",
      status: "online",
    },
    hostId: "host-a",
    agents: [
      {
        agentDefinitionId: "agent-a",
        displayName: "Alice",
        handle: "alice",
        runtimeAvailable: true,
        state: "enabled",
      },
    ],
    runtimes: [
      {
        available: true,
        configured: true,
        displayName: "Codex",
        executable: "codex",
        runtimeOfferId: "offer-a",
        runtimeProfileId: "profile-a",
        version: "1.2.3",
      },
    ],
  });
  assert.doesNotMatch(
    text,
    /participant-a|profile-revision-a|environment|token|secret/iu,
  );
  assert.doesNotMatch(text, /agent-b|Bob|bob/u);
  assert.ok(text.length < 4_096);
});
