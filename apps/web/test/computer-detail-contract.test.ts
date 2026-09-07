import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/workspace-catalog-panes.tsx", import.meta.url),
  "utf8",
);
const inspector = readFileSync(
  new URL("../src/components/computer-runtime-inspector.tsx", import.meta.url),
  "utf8",
);
const profileFields = readFileSync(
  new URL("../src/components/computer-profile-fields.tsx", import.meta.url),
  "utf8",
);
const browserGate = readFileSync(
  new URL("../../../scripts/run-real-browser-gate.mjs", import.meta.url),
  "utf8",
);
const firefoxBrowserGate = readFileSync(
  new URL("../../../scripts/run-firefox-workbench-gate.mjs", import.meta.url),
  "utf8",
);

test("Computer pane does not reuse Room dimensions or synthesize Agent avatars", () => {
  assert.doesNotMatch(source, /RAFT_ROOM_SIDEBAR_/u);
  assert.match(source, /readComputerSidebarWidth/u);
  assert.match(source, /<ComputerAgentControls/u);
  const controls = readFileSync(
    new URL("../src/components/computer-agent-controls.tsx", import.meta.url),
    "utf8",
  );
  assert.match(controls, /<AgentEntityCard/u);
  assert.match(controls, /onOpen=\{onOpen\}/u);
  assert.doesNotMatch(controls, /handle\.slice\(0, 1\)/u);
  assert.match(source, /onOpen=\{onOpenAgent\}/u);
  const card = readFileSync(
    new URL("../src/components/agent-entity-card.tsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /<AgentAvatar/u);
  assert.match(card, /onOpen\(agent\.agentDefinitionId\)/u);
  assert.doesNotMatch(source, /binding\.handle\.slice\(0, 1\)\.toUpperCase/u);
});

test("detected Runtime chips expose the Raft-shaped inspector", () => {
  assert.match(source, /<ComputerRuntimeInspector/u);
  assert.match(inspector, /aria-haspopup="dialog"/u);
  assert.match(inspector, /suppressNextFocusOpen/u);
  assert.match(source, /复制诊断信息/u);
  assert.match(source, /npm run doctor:local-core/u);
});

test("Computer profile uses the durable Raft edit contract", () => {
  assert.match(source, /<ComputerProfileFields/u);
  assert.match(profileFields, /maxLength=\{120\}/u);
  assert.match(profileFields, /maxLength=\{500\}/u);
  assert.match(profileFields, /computerProfileEditorAction/u);
  assert.match(profileFields, /expectedRevision: edit\.revision/u);
  assert.match(profileFields, /crypto\.randomUUID\(\)/u);
  assert.match(profileFields, /正在保存/u);
  assert.match(profileFields, /保存失败，草稿已保留/u);
});

test("real browser acceptance follows the shared profile action contract", () => {
  assert.match(browserGate, /aria-label="编辑计算机名称"/u);
  assert.match(browserGate, /aria-label="编辑计算机描述"/u);
  assert.doesNotMatch(browserGate, /rah-computer-profile-edit/u);
});

test("real browser acceptance follows the shared Agent entity-card contract", () => {
  assert.match(browserGate, /rah-entity-card-name/u);
  assert.match(firefoxBrowserGate, /rah-entity-card-name/u);
  assert.doesNotMatch(firefoxBrowserGate, /locator\("b"\)/u);
});
