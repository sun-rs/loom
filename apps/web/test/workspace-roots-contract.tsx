import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { FakeRahClient } from "@rah-os/client-sdk";
import type { AgentWorkspaceRoot } from "@rah-os/protocol";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import "../src/agent-workspace.css";
import { AgentWorkspaceBrowser } from "../src/components/agent-workspace-browser.tsx";

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const roots = {
  defaultRootId: "agent-workspace" as const,
  roots: [
    {
      label: "Agent 工作区",
      rootId: "agent-workspace" as const,
      rootKind: "agent-workspace" as const,
      rootPath: "/fixture/agents/alice",
      state: "ready" as const,
    },
    {
      label: "rah_os",
      rootId: "runtime-project" as const,
      rootKind: "runtime-project" as const,
      rootPath: "/fixture/projects/rah_os",
      state: "ready" as const,
    },
  ],
};
function entries(rootId: AgentWorkspaceRoot["rootId"], path: string) {
  const common = {
    rootId,
    rootKind: rootId,
    rootLabel: rootId === "agent-workspace" ? "Agent 工作区" : "rah_os",
    rootPath:
      rootId === "agent-workspace"
        ? "/fixture/agents/alice"
        : "/fixture/projects/rah_os",
    state: "ready" as const,
    path,
    truncated: false,
  };
  if (path === "src")
    return {
      ...common,
      entries: [
        {
          isDirectory: false,
          isHidden: false,
          modifiedAt: "2026-09-02T00:00:00.000Z",
          name: "index.ts",
          path: "src/index.ts",
          size: 11,
        },
      ],
    };
  return {
    ...common,
    entries:
      rootId === "agent-workspace"
        ? [
            {
              isDirectory: false,
              isHidden: false,
              modifiedAt: "2026-09-02T00:00:00.000Z",
              name: "MEMORY.md",
              path: "MEMORY.md",
              size: 14,
            },
          ]
        : [
            {
              isDirectory: true,
              isHidden: false,
              modifiedAt: "2026-09-02T00:00:00.000Z",
              name: "src",
              path: "src",
              size: 64,
            },
            {
              isDirectory: false,
              isHidden: false,
              modifiedAt: "2026-09-02T00:00:00.000Z",
              name: "README.md",
              path: "README.md",
              size: 13,
            },
          ],
  };
}
const calls: string[] = [];
const client = new FakeRahClient(async (operation, rawInput) => {
  if (operation === "agent.workspace.roots") return roots;
  const input = rawInput as {
    rootId: AgentWorkspaceRoot["rootId"];
    path: string;
  };
  calls.push(`${operation}:${input.rootId}:${input.path}`);
  if (operation === "agent.workspace.list")
    return entries(input.rootId, input.path);
  if (operation === "agent.workspace.read")
    return {
      content:
        input.rootId === "agent-workspace" ? "# Alice memory" : "# RAH project",
      encoding: "utf-8",
      mimeType: "text/plain",
      path: input.path,
      rootId: input.rootId,
      rootKind: input.rootId,
      rootLabel: input.rootId === "agent-workspace" ? "Agent 工作区" : "rah_os",
      size: input.rootId === "agent-workspace" ? 14 : 13,
    };
  throw new Error(`unexpected operation ${operation}`);
});

function Fixture() {
  const [report, setReport] = useState("等待开始");
  async function run() {
    const failures: string[] = [];
    const check = (value: unknown, message: string) => {
      if (!value) failures.push(message);
    };
    for (let index = 0; index < 4; index++) await frame();
    const select = document.querySelector<HTMLSelectElement>(
      '[aria-label="工作区根目录"]',
    );
    check(!select, "Agent 工作区不提供运行项目选择器");
    check(document.body.textContent?.includes("MEMORY.md"), "默认根非空树");
    check(
      !document.querySelector(".rah-workspace-browser footer"),
      "工作区不显示额外说明或记忆管理",
    );
    check(
      !document.body.textContent?.includes("记忆管理"),
      "项目根不显示记忆控制",
    );
    [...document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')]
      .find((button) => button.textContent?.trim() === "MEMORY.md")
      ?.click();
    for (let index = 0; index < 4; index++) await frame();
    check(
      document.body.textContent?.includes("Alice memory"),
      "Agent 文件读取",
    );
    check(
      document.querySelector('[aria-label="工作区文件查看模式"]'),
      "Markdown 必须提供源码/预览",
    );
    check(
      calls.includes("agent.workspace.read:agent-workspace:MEMORY.md") &&
        calls.every((call) => !call.includes("runtime-project")),
      "read/list 必须始终绑定 Agent 工作区",
    );
    check(
      document.documentElement.scrollWidth <= innerWidth,
      "工作区不得横向溢出",
    );
    flushSync(() =>
      setReport(
        JSON.stringify({
          result: failures.length === 0 ? "PASS" : "FAIL",
          failures,
          calls,
        }),
      ),
    );
  }
  return (
    <main
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <button type="button" onClick={() => void run()}>
        运行工作区根回归
      </button>
      <output id="workspace-roots-report">{report}</output>
      <AgentWorkspaceBrowser agentDefinitionId="agent-alice" client={client} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
