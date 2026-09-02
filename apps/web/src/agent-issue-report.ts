import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";

import { renderAgentActivityDiagnostics } from "./agent-activity-diagnostics.ts";

export const AGENT_ISSUE_REPORT_SCHEMA_VERSION =
  "rah-agent-issue-report-v1" as const;

export type AgentIssueReportIdentity = {
  agentDefinitionId: string;
  displayName: string;
  handle: string;
  participantId: string;
};

export type AgentIssueReportBrowser = {
  language: string;
  pathname: string;
  userAgent: string;
  viewport: { height: number; width: number };
};

export type AgentIssueReport = {
  agent: AgentIssueReportIdentity;
  browser: AgentIssueReportBrowser | null;
  disclosure: {
    excluded: readonly string[];
    transport: "local_download";
  };
  generatedAt: string;
  issue: { description: string | null };
  logs: {
    activityDiagnostics: {
      included: boolean;
      recordCount: number;
      text: string | null;
    };
  };
  schemaVersion: typeof AGENT_ISSUE_REPORT_SCHEMA_VERSION;
};

export function buildAgentIssueReport(input: {
  activities: readonly RuntimeTrajectoryRecord[];
  agent: AgentIssueReportIdentity;
  browser?: AgentIssueReportBrowser | undefined;
  description?: string | undefined;
  generatedAt?: string | undefined;
  includeActivityDiagnostics: boolean;
}): AgentIssueReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const activities = input.includeActivityDiagnostics ? input.activities : [];
  return {
    agent: input.agent,
    browser: input.browser ?? null,
    disclosure: {
      excluded: [
        "room_and_dm_message_bodies",
        "reasoning",
        "tool_inputs_and_results",
        "provider_stdout_and_stderr",
        "environment_variables",
        "memory_and_files",
        "credentials",
        "runtime_transcript",
      ],
      transport: "local_download",
    },
    generatedAt,
    issue: { description: input.description?.trim() || null },
    logs: {
      activityDiagnostics: {
        included: input.includeActivityDiagnostics,
        recordCount: activities.length,
        text: input.includeActivityDiagnostics
          ? renderAgentActivityDiagnostics(input.agent, activities)
          : null,
      },
    },
    schemaVersion: AGENT_ISSUE_REPORT_SCHEMA_VERSION,
  };
}

export function makeAgentIssueReportFilename(
  agentName: string,
  generatedAt = new Date().toISOString(),
): string {
  const safeAgent =
    agentName
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") || "agent";
  const safeTime = generatedAt.replace(/[:.]/gu, "-");
  return `rah-agent-issue-${safeAgent}-${safeTime}.json`;
}

type DownloadAnchor = {
  click(): void;
  download: string;
  href: string;
  remove(): void;
};

export type AgentIssueReportDownloadEnvironment = {
  append(anchor: DownloadAnchor): void;
  createAnchor(): DownloadAnchor;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
};

function browserDownloadEnvironment(): AgentIssueReportDownloadEnvironment {
  return {
    append: (anchor) => document.body.append(anchor as HTMLAnchorElement),
    createAnchor: () => document.createElement("a"),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

export function downloadAgentIssueReport(
  report: AgentIssueReport,
  filename: string,
  environment: AgentIssueReportDownloadEnvironment = browserDownloadEnvironment(),
): void {
  const url = environment.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = environment.createAnchor();
  anchor.href = url;
  anchor.download = filename;
  try {
    environment.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    environment.revokeObjectURL(url);
  }
}
