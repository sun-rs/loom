import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

import {
  buildAgentIssueReport,
  downloadAgentIssueReport,
  makeAgentIssueReportFilename,
} from "../src/agent-issue-report.ts";

const activity: RuntimeTrajectoryRecord = {
  activityId: "activity-1",
  entry: {
    kind: "tool_start",
    toolInput: "SECRET=must-not-export",
    toolName: "shell",
  },
  observedAt: "2026-09-02T01:02:03.000Z",
  participantId: "participant-1",
  producerSequence: 1,
  recordedAt: "2026-09-02T01:02:03.100Z",
  roomId: "room-1",
  runAttemptId: "attempt-1",
  runtimeRunId: "runtime-1",
  serverSequence: 2,
};

test("local Agent issue report exports only bounded correlation diagnostics", () => {
  const report = buildAgentIssueReport({
    activities: [activity],
    agent: {
      agentDefinitionId: "agent-1",
      displayName: "Cindy",
      handle: "cindy",
      participantId: "participant-1",
    },
    browser: {
      language: "zh-CN",
      pathname: "/w/workspace/agents/agent-1",
      userAgent: "browser",
      viewport: { height: 844, width: 390 },
    },
    description: "  页面出现问题  ",
    generatedAt: "2026-09-02T01:02:04.000Z",
    includeActivityDiagnostics: true,
  });

  assert.equal(report.schemaVersion, "rah-agent-issue-report-v1");
  assert.equal(report.issue.description, "页面出现问题");
  assert.equal(report.logs.activityDiagnostics.included, true);
  assert.match(report.logs.activityDiagnostics.text ?? "", /tool="shell"/u);
  const encoded = JSON.stringify(report);
  assert.doesNotMatch(encoded, /SECRET=must-not-export/u);
  assert.doesNotMatch(encoded, /toolInput/u);
  assert.doesNotMatch(encoded, /recentMessages|runtimeTranscript/u);
});

test("local Agent issue report can omit activities and cleans its filename", () => {
  const report = buildAgentIssueReport({
    activities: [activity],
    agent: {
      agentDefinitionId: "agent-1",
      displayName: "Agent / 名称",
      handle: "agent",
      participantId: "participant-1",
    },
    description: "   ",
    generatedAt: "2026-09-02T01:02:04.000Z",
    includeActivityDiagnostics: false,
  });
  assert.equal(report.issue.description, null);
  assert.deepEqual(report.logs.activityDiagnostics, {
    included: false,
    recordCount: 0,
    text: null,
  });
  assert.equal(
    makeAgentIssueReportFilename("Agent / 名称", "2026-09-02T01:02:04.000Z"),
    "rah-agent-issue-Agent-2026-09-02T01-02-04-000Z.json",
  );
});

test("download revokes its object URL after the local click", () => {
  const calls: string[] = [];
  const anchor = {
    click: () => calls.push("click"),
    download: "",
    href: "",
    remove: () => calls.push("remove"),
  };
  downloadAgentIssueReport(
    buildAgentIssueReport({
      activities: [],
      agent: {
        agentDefinitionId: "agent-1",
        displayName: "Cindy",
        handle: "cindy",
        participantId: "participant-1",
      },
      generatedAt: "2026-09-02T01:02:04.000Z",
      includeActivityDiagnostics: false,
    }),
    "report.json",
    {
      append: () => calls.push("append"),
      createAnchor: () => anchor,
      createObjectURL: () => "blob:report",
      revokeObjectURL: (url) => calls.push(`revoke:${url}`),
    },
  );
  assert.equal(anchor.href, "blob:report");
  assert.equal(anchor.download, "report.json");
  assert.deepEqual(calls, ["append", "click", "remove", "revoke:blob:report"]);
});

test("Agent issue entry is enabled and uses the shared modal protocol", () => {
  const profile = readFileSync(
    new URL("../src/components/agent-directory-pane.tsx", import.meta.url),
    "utf8",
  );
  assert.match(profile, /<AgentIssueReportDialog/u);
  assert.match(profile, /setIssueReportOpen\(true\)/u);
  assert.doesNotMatch(profile, /本地问题报告流程尚未接入/u);

  const dialog = readFileSync(
    new URL("../src/components/agent-issue-report-dialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dialog, /useDialogProtocol/u);
  assert.match(dialog, /agent\.trajectory\.list/u);
  assert.match(dialog, /data-dialog-initial-focus/u);
  assert.match(dialog, /敏感数据/u);
  assert.match(dialog, /导出到本机/u);
  assert.doesNotMatch(dialog, /上传成功|reportId|scope-attestation/u);
});
