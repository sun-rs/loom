import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import {
  selectBoundRuntime,
  runtimeProfilePresentation,
} from "../src/agent-runtime-presentation.ts";

const runtime = (name: string): LocalRuntimeInventoryEntry => ({
  displayName: name,
  runtimeProfileId: name,
  available: true,
  configured: true,
  source: "configured",
  executable: "/fake/cli",
  agentBindings: [],
  modelBindingDescriptors: [],
});
test("profile and preview runtime resolution is order independent and does not guess", () => {
  const a = runtime("A"),
    b = runtime("B");
  assert.equal(selectBoundRuntime([a, b]), undefined);
  assert.equal(selectBoundRuntime([b, a], "missing"), undefined);
  assert.equal(selectBoundRuntime([a], "missing"), a);
  assert.equal(
    runtimeProfilePresentation([a, b], undefined).runtimeLabel,
    "多个运行时绑定",
  );
  assert.equal(
    runtimeProfilePresentation([], undefined).runtimeLabel,
    "未绑定",
  );
});
test("unknown profile does not claim defaults, and unsupported effort is not fabricated", () => {
  const a = runtime("A");
  assert.equal(
    runtimeProfilePresentation([a], undefined).modelLabel,
    "配置尚未加载",
  );
  assert.equal(
    runtimeProfilePresentation([a], undefined, "loading").modelLabel,
    "加载中…",
  );
  assert.equal(
    runtimeProfilePresentation([a], undefined, "error").modelLabel,
    "暂时无法读取",
  );
  assert.equal(
    runtimeProfilePresentation([a], { reasoning: "default" }).reasoningLabel,
    "默认",
  );
});
test("exact model identity selects the same runtime irrespective of inventory order", () => {
  const a = runtime("A"),
    b = runtime("B");
  b.modelBindingDescriptors.push({
    modelBindingId: "bound",
    modelId: "real-model",
    displayName: "Verified Model",
    provider: "fake",
    evidence: "probed",
    capabilityClasses: ["deep_coding"],
    supportedReasoning: ["high"],
    supportedServiceTiers: ["default"],
    reasoningOptions: [{ value: "high", label: "High" }],
  });
  const intent = { exactBindingIds: ["bound"], reasoning: "high" };
  for (const inputs of [
    [a, b],
    [b, a],
  ]) {
    const result = runtimeProfilePresentation(inputs, intent);
    assert.equal(result.runtime, b);
    assert.equal(result.modelLabel, "real-model");
    assert.equal(result.reasoningLabel, "High");
  }
});
test("Agent/Computer sections consume the shared profile owner without page geometry copies", () => {
  for (const path of [
    "agent-directory-pane",
    "computer-profile-fields",
    "workspace-catalog-panes",
  ]) {
    const source = readFileSync(`apps/web/src/components/${path}.tsx`, "utf8");
    assert.match(source, /<ProfileSection/);
  }
  const agent = readFileSync(
    "apps/web/src/components/agent-directory-pane.tsx",
    "utf8",
  );
  assert.doesNotMatch(
    agent.slice(
      agent.indexOf("export function AgentProfilePane"),
      agent.indexOf("function AgentProfileAvatarEditor"),
    ),
    /runtimes\[0\]/,
  );
  const computer = readFileSync("apps/web/src/computer-directory.css", "utf8");
  assert.doesNotMatch(
    computer,
    /min-height: var\(--raft-computers-(?:name|info)-section-height\)/,
  );
});
test("preview row geometry has no late page override", () => {
  const page = readFileSync("apps/web/src/chat-surface.css", "utf8");
  assert.doesNotMatch(page, /\.rah-preview-event[^{}]*\{/);
  const css = readFileSync(
    "packages/ui-tokens/src/neo-brutalist/preview.css",
    "utf8",
  );
  assert.match(css, /\.rah-preview-event \{[^}]*line-height: 16px/s);
  assert.match(
    css,
    /\.rah-preview-event \+ \.rah-preview-event \{[^}]*margin-top: 6px/s,
  );
});
test("full Agent directory uses the same scoped runtime join as identity previews", () => {
  const source = readFileSync(
    "apps/web/src/components/agent-directory-pane.tsx",
    "utf8",
  );
  assert.match(
    source,
    /entities\?\.runtimesForAgent\(selectedAgent\.agentId\)/,
  );
  assert.doesNotMatch(source, /runtimes\.filter\(/);
});

test("missing runtime catalogs show native model IDs for historical Agents", () => {
  for (const [binding, native] of [
    ["local:kimi-cli/v1:kimi-code/k3", "kimi-code/k3"],
    [
      "local:opencode-cli/v1:iiiiitoken/gemini-3.8-flash-high",
      "iiiiitoken/gemini-3.8-flash-high",
    ],
    ["local:codex-cli/v1:gpt-6-astra", "gpt-6-astra"],
    ["vendor/model", "vendor/model"],
  ]) {
    for (const state of ["ready", "loading", "error"] as const)
      assert.equal(
        runtimeProfilePresentation([], { exactBindingIds: [binding!] }, state)
          .modelLabel,
        native,
      );
  }
});

test("profile model identity is native across catalog, custom and unavailable runtime paths", () => {
  for (const native of [
    "kimi-code/k3",
    "iiiiitoken/gemini-3.8-flash-high",
    "gpt-6-astra",
  ]) {
    const binding = `local:test-cli/v1:${native}`;
    const entry = runtime("test");
    entry.modelBindingDescriptors.push({
      modelBindingId: binding,
      modelId: binding,
      displayName: "Friendly model",
      provider: "synthetic-provider",
      evidence: "probed",
      capabilityClasses: [],
      supportedReasoning: [],
      supportedServiceTiers: [],
    });
    for (const state of ["ready", "loading", "error"] as const) {
      assert.equal(
        runtimeProfilePresentation(
          [entry],
          { exactBindingIds: [binding] },
          state,
        ).modelLabel,
        native,
      );
      assert.equal(
        runtimeProfilePresentation(
          [],
          { customModel: { modelId: binding } },
          state,
        ).modelLabel,
        native,
      );
    }
  }
});
