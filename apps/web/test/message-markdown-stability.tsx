import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { RahClient } from "@rah-os/client-sdk";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import {
  MessageMarkdown,
  type MessageMarkdownReferences,
} from "../src/components/message-markdown.tsx";
import { AgentMessageContext } from "../src/components/workspace-entity-context.tsx";
import { MessageTimeline } from "../src/components/message-timeline.tsx";
import {
  ChannelRowIdentity,
  RoomAttentionBadges,
} from "../src/components/sidebar-attention.tsx";
import { WorkspaceActivityFooter } from "../src/components/workspace-activity-footer.tsx";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

const original = [
  "Markdown 稳定性回归",
  "```mermaid",
  "graph LR",
  "Room --> Agent",
  "```",
  "```ts",
  "const canonical = true;",
  "```",
  "请 @Alice 查看 task #2 和 #project-room。",
  "@Hakase dm:@Alice #project-room:abcdef computer:host-mac app:com.example.calendar。",
  "#project-room msg=message-1 #project-room:abcdef msg=message-2。",
  "`@Alice #2 #project-room` 保持代码文字。",
  "[@Alice #2 #project-room](https://example.com/reference) 保持作者链接。",
  "[打开本地文件](file:///tmp/markdown-regression.ts)",
  "![RAH icon](/rah-app-icon.svg)",
].join("\n");

const references: MessageMarkdownReferences = {
  agents: [
    {
      agentDefinitionId: "agent-alice",
      createdAt: "2026-09-02T00:00:00.000Z",
      createdBy: "human",
      displayName: "Alice Assistant",
      executionPolicyRevisionId: "policy-alice",
      handle: "Alice",
      participantId: "participant-alice",
      role: "Assistant",
      runtimeAvailable: true,
      runtimeLabels: [],
      skillRefs: [],
      state: "enabled",
    },
  ],
  computers: [{ hostId: "host-mac", names: ["Mac Studio"] }],
  currentPrincipal: {
    handle: "Hakase",
    kind: "human",
    principalId: "human-hakase",
  },
  mentionReadStates: { "participant-alice": "read" },
  principals: [
    {
      handle: "Hakase",
      kind: "human",
      principalId: "human-hakase",
    },
  ],
  rooms: [
    {
      kind: "channel",
      names: ["project-room"],
      roomId: "room-project",
    },
    {
      kind: "direct",
      names: ["dm-alice"],
      peerNames: ["Alice"],
      roomId: "room-alice-dm",
    },
  ],
  tasks: [
    {
      target: {
        kind: "task",
        roomId: "room-project",
        rootMessageId: "message-task-2",
        taskId: "task-2",
        threadId: "thread-task-2",
      },
      taskId: "task-2",
      taskNumber: 2,
    },
  ],
  threads: [
    {
      roomId: "room-project",
      roomKind: "channel",
      roomName: "project-room",
      rootMessageId: "message-root",
      threadId: "thread-abcdef",
    },
  ],
};

const previewClient = {
  request: () => Promise.reject(new Error("fixture has no Agent backend")),
} as unknown as RahClient;

const workingAgent = {
  agentDefinitionId: "agent-working",
  avatarKey: "skull",
  connectionStatus: "online",
  createdAt: "2026-09-03T00:00:00.000Z",
  createdBy: "human-hakase",
  displayName: "Working Agent",
  executionPolicyRevisionId: "policy-working",
  handle: "WorkingAgent",
  participantId: "participant-working",
  presence: {
    activity: "thinking",
    activityAt: new Date().toISOString(),
    agentDefinitionId: "agent-working",
    reason: "thinking",
  },
  role: "Assistant",
  runtimeAvailable: true,
  runtimeLabels: [],
  skillRefs: [],
  state: "enabled",
} as WorkspaceAgentView;

const onlineAgent = {
  ...workingAgent,
  agentDefinitionId: "agent-online",
  displayName: "Online Agent",
  handle: "OnlineAgent",
  participantId: "participant-online",
  presence: {
    activity: "online",
    agentDefinitionId: "agent-online",
    reason: "online",
  },
} as WorkspaceAgentView;

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 15_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("等待图表加载超时");
    await frame();
  }
}

function Fixture() {
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState(original);
  const [report, setReport] = useState("等待开始");
  const [running, setRunning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const linkRevision = useRef(-1);
  const openedTarget = useRef("");

  async function run() {
    setRunning(true);
    const failures: string[] = [];
    const check = (condition: boolean, label: string) => {
      if (!condition && !failures.includes(label)) failures.push(label);
    };
    try {
      flushSync(() => {
        setSource(original);
        setRevision(0);
      });
      await until(
        () =>
          scroller.current?.querySelector("iframe") !== null &&
          scroller.current?.querySelector(".shiki") !== null,
      );
      await frame();
      await frame();
      const initialFrame = scroller.current!.querySelector("iframe")!;
      const initialImage = scroller.current!.querySelector("img")!;
      const initialCode =
        scroller.current!.querySelector(".rah-markdown-code")!;
      let refreshes = 0;
      for (let next = 1; next <= 20; next++) {
        flushSync(() => setRevision(next));
        await frame();
        check(
          scroller.current!.querySelector("iframe") === initialFrame,
          "图表 iframe 被状态刷新替换",
        );
        check(
          scroller.current!.querySelector("img") === initialImage,
          "图片被状态刷新替换",
        );
        check(
          scroller.current!.querySelector(".rah-markdown-code") === initialCode,
          "代码块被状态刷新替换",
        );
        const rows = [
          ...scroller.current!.querySelectorAll(".rah-message-virtual-row"),
        ];
        check(
          rows.length === 2 &&
            rows[1]!.getBoundingClientRect().top >=
              rows[0]!.getBoundingClientRect().bottom - 1,
          "图表与后续消息重叠",
        );
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const sourceButton = [
        ...scroller.current!.querySelectorAll<HTMLButtonElement>("button"),
      ].find((b) => b.textContent === "源码")!;
      sourceButton.click();
      await frame();
      flushSync(() => setRevision(21));
      await frame();
      check(
        scroller.current!.querySelector(".rah-mermaid-source") !== null,
        "源码选择被状态刷新重置",
      );
      scroller
        .current!.querySelector<HTMLButtonElement>(".rah-markdown-file")!
        .click();
      check(linkRevision.current === 21, "文件链接没有使用最新回调");
      flushSync(() =>
        setSource(original.replace("Room --> Agent", "Room --> Changed")),
      );
      await frame();
      check(
        scroller
          .current!.querySelector(".rah-mermaid-source")
          ?.textContent?.includes("Changed") === true,
        "正文更新未显示新源码",
      );
      [...scroller.current!.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "图表")!
        .click();
      await until(
        () =>
          scroller
            .current!.querySelector("iframe")
            ?.srcdoc.includes("Changed") === true,
      );
      const updated = scroller.current!.querySelector("iframe")!;
      check(
        updated.getAttribute("sandbox") === "" &&
          updated.srcdoc.includes("default-src 'none'"),
        "图表沙箱/CSP边界变化",
      );
      check(
        scroller.current!.querySelector(".rah-rich-agent-reference")
          ?.textContent === "@Alice",
        "Agent 引用未按目录解析",
      );
      scroller
        .current!.querySelector<HTMLButtonElement>(".rah-rich-agent-reference")!
        .click();
      check(
        openedTarget.current === "agent:agent-alice",
        "Agent 引用未走 inspector owner",
      );
      const taskReference = scroller.current!.querySelector<HTMLButtonElement>(
        ".rah-rich-task-reference",
      );
      check(taskReference?.textContent === "task #2", "Task 引用未显示");
      taskReference?.click();
      check(openedTarget.current === "task:task-2", "Task 引用未走 typed 导航");
      check(
        scroller.current!.querySelector(".rah-rich-room-reference")
          ?.textContent === "#project-room",
        "Room 引用未按目录解析",
      );
      check(
        scroller.current!.querySelector(".rah-rich-self-reference")
          ?.textContent === "@Hakase",
        "当前 Human mention 未使用 Raft 自身标签",
      );
      check(
        scroller.current!.querySelector(".rah-rich-thread-reference")
          ?.textContent === "#project-room:abcdef",
        "Thread 引用未按 typed identity 解析",
      );
      check(
        scroller.current!.querySelector(".rah-rich-computer-reference")
          ?.textContent === "computer:host-mac",
        "Computer 引用未按 typed identity 解析",
      );
      check(
        scroller.current!.querySelector(".rah-rich-app-reference")
          ?.textContent === "app:com.example.calendar",
        "App 引用未按协议显示",
      );
      check(
        scroller.current!.querySelectorAll(".rah-rich-message-reference")
          .length === 2,
        "精确消息引用未完整解析",
      );
      check(
        scroller.current!.querySelector("[data-mention-read-state=read]") !==
          null,
        "Agent mention 已读状态未显示",
      );
      const resolvedBackground = (value: string) => {
        const probe = document.createElement("span");
        probe.style.background = value;
        document.body.append(probe);
        const background = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return background;
      };
      const style = (selector: string) => {
        const element = scroller.current!.querySelector<HTMLElement>(selector);
        check(element !== null, `${selector} 缺失，无法核验 computed style`);
        return element === null ? undefined : getComputedStyle(element);
      };
      const agentStyle = style(".rah-rich-agent-reference");
      check(
        agentStyle?.fontWeight === "700" &&
          agentStyle.textDecorationLine.includes("underline") &&
          agentStyle.textDecorationThickness === "2px" &&
          agentStyle.textUnderlineOffset === "2px",
        "Agent mention 字重或下划线协议偏离 Raft",
      );
      const taskStyle = style(".rah-rich-task-reference");
      check(
        taskStyle?.borderTopWidth === "1px" &&
          taskStyle.borderRightWidth === "1px" &&
          taskStyle.paddingLeft === "4px" &&
          taskStyle.paddingRight === "4px" &&
          taskStyle.fontWeight === "700" &&
          taskStyle.backgroundColor ===
            resolvedBackground(
              "color-mix(in srgb, var(--yellow) 40%, transparent)",
            ),
        "Task chip 外框、比例或常态底色偏离 Raft",
      );
      check(
        style(".rah-rich-room-reference")?.backgroundColor ===
          resolvedBackground(
            "color-mix(in srgb, var(--pink) 30%, transparent)",
          ),
        "Room 引用常态底色偏离 Raft",
      );
      const threadBackground = style(
        ".rah-rich-thread-reference",
      )?.backgroundColor;
      check(
        threadBackground ===
          resolvedBackground(
            "color-mix(in srgb, var(--cyan) 30%, transparent)",
          ) &&
          style(".rah-rich-computer-reference")?.backgroundColor ===
            threadBackground,
        "Thread/Computer 引用底色协议不一致",
      );
      const yellowReferenceBackground = resolvedBackground(
        "color-mix(in srgb, var(--yellow) 40%, transparent)",
      );
      check(
        style(".rah-rich-app-reference")?.backgroundColor ===
          yellowReferenceBackground &&
          style(".rah-rich-message-reference")?.backgroundColor ===
            yellowReferenceBackground,
        "App/Message 引用底色协议不一致",
      );
      check(
        style("[data-mention-read-state=read]")?.backgroundColor ===
          resolvedBackground("var(--green)"),
        "mention read receipt 未使用 canonical 绿色",
      );
      const clickReference = (selector: string, expected: string) => {
        scroller.current!.querySelector<HTMLButtonElement>(selector)?.click();
        check(openedTarget.current === expected, `${selector} 未走 typed 导航`);
      };
      clickReference(".rah-rich-thread-reference", "thread:thread-abcdef");
      clickReference(".rah-rich-computer-reference", "computer:host-mac");
      clickReference(".rah-rich-message-reference", "message:message-1");
      check(
        [...scroller.current!.querySelectorAll("code")].some(
          (element) =>
            element.textContent === "@Alice #2 #project-room" &&
            element.querySelector("button, mark") === null,
        ),
        "代码节点被富文本引用重写",
      );
      const authoredLink = scroller.current!.querySelector<HTMLAnchorElement>(
        'a[href="https://example.com/reference"]',
      );
      check(
        authoredLink?.textContent === "@Alice #2 #project-room" &&
          authoredLink.querySelector("button, mark") === null,
        "作者 Markdown link 被富文本引用二次改写",
      );
      setReport(
        JSON.stringify(
          {
            result: failures.length === 0 ? "PASS" : "FAIL",
            refreshes,
            failures,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      setReport(`FAIL: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1>消息渲染稳定性（无后端、无模型调用）</h1>
      <button disabled={running} onClick={() => void run()} type="button">
        开始回归
      </button>
      <pre role="status">{report}</pre>
      <p>父组件刷新：{revision}</p>
      <div aria-label="Room 注意力标记浏览器样本">
        <button className="channel-row" data-testid="channel-attention">
          <ChannelRowIdentity muted={false} name="Channel" />
          <RoomAttentionBadges
            kind="channel"
            value={{ unreadCount: 3, hasMention: true }}
          />
        </button>
        <button className="channel-row" data-testid="quiet-channel-attention">
          <ChannelRowIdentity muted name="Muted Channel" />
          <RoomAttentionBadges
            kind="channel"
            quiet
            value={{ unreadCount: 7, hasMention: false }}
          />
        </button>
        <button
          className="channel-row rah-direct-room-row"
          data-testid="direct-attention"
        >
          <span className="rah-direct-row-identity">
            <span className="rah-direct-row-name">Direct</span>
          </span>
          <RoomAttentionBadges
            kind="direct"
            value={{ unreadCount: 4, hasMention: true }}
          />
        </button>
      </div>
      <div data-testid="direct-activity-working">
        <WorkspaceActivityFooter agents={[workingAgent]} />
      </div>
      <div data-testid="direct-activity-online">
        <WorkspaceActivityFooter agents={[onlineAgent]} />
      </div>
      <div
        ref={scroller}
        style={{
          height: 700,
          overflow: "auto",
          border: "2px solid black",
          width: "100%",
        }}
      >
        <AgentMessageContext.Provider
          value={{
            client: previewClient,
            computerLabel: undefined,
            onOpen: (agentDefinitionId) => {
              openedTarget.current = `agent:${agentDefinitionId}`;
            },
            runtimes: [],
          }}
        >
          <MessageTimeline
            followOnAppend={false}
            getItemKey={(item) => item.id}
            items={[
              { id: "markdown", body: source },
              { id: "after", body: "后续消息，不能被图表覆盖" },
            ]}
            renderItem={(item) => (
              <MessageMarkdown
                source={item.body}
                references={{
                  ...references,
                  onOpenTarget: (target) => {
                    openedTarget.current = `${target.kind}:${
                      target.kind === "task"
                        ? target.taskId
                        : target.kind === "thread"
                          ? target.threadId
                          : target.kind === "computer"
                            ? target.hostId
                            : target.kind === "message"
                              ? target.messageId
                              : target.kind === "room"
                                ? target.roomId
                                : "target"
                    }`;
                  },
                }}
                onOpenFile={() => {
                  linkRevision.current = revision;
                }}
              />
            )}
            scrollElementRef={scroller}
          />
        </AgentMessageContext.Provider>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
