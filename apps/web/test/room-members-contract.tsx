import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { Principal, Room } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import "../src/agent-directory.css";
import { RoomMembersDialog } from "../src/components/room-dialogs.tsx";

const agents: WorkspaceAgentView[] = ["Alice", "Kimi", "Grok", "Cindy"].map(
  (handle, index) => ({
    participantId: handle,
    handle,
    displayName: handle,
    agentDefinitionId: `agent-${handle}`,
    createdAt: "2026-08-31T00:00:00.000Z",
    createdBy: "owner",
    executionPolicyRevisionId: "policy",
    role: "Assistant",
    runtimeAvailable: true,
    runtimeLabels: ["Fake"],
    skillRefs: [],
    state: "enabled",
    connectionStatus: "offline",
    ...(index === 0
      ? { avatarKey: "codex" }
      : index === 1
        ? { avatarKey: "kimi" }
        : {}),
  }),
);
const human: Principal = {
  principalId: "owner",
  handle: "Owner",
  kind: "human",
};
const reviewer: Principal = {
  principalId: "reviewer",
  handle: "Reviewer",
  kind: "human",
};
const room: Room = {
  roomId: "isolated-room",
  workspaceId: "isolated",
  name: "成员回归",
  slug: "members-test",
  kind: "channel",
  visibility: "public",
  createdAt: "2026-08-31T00:00:00.000Z",
};
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
function Fixture() {
  const [open, setOpen] = useState(true);
  const [archivedAt, setArchivedAt] = useState<string>();
  const [joined, setJoined] = useState(["Alice", "Kimi"]);
  const [reviewerRole, setReviewerRole] = useState<"member" | "admin">(
    "member",
  );
  const [report, setReport] = useState("等待开始");
  const calls = useRef<string[]>([]);
  const failCindy = useRef(true);
  const leaveCalls = useRef(0);
  const sosCalls = useRef<string[]>([]);
  async function run() {
    const failures: string[] = [];
    const check = (value: unknown, message: string) => {
      if (!value) failures.push(message);
    };
    try {
      flushSync(() => setOpen(false));
      flushSync(() => {
        setOpen(true);
        setJoined(["Alice", "Kimi"]);
      });
      await frame();
      await frame();
      const tiles = [
        ...document.querySelectorAll<HTMLElement>(
          ".rah-channel-member-avatars .rah-agent-avatar, .rah-channel-member-avatars .rah-channel-human-avatar, .rah-channel-member-add",
        ),
      ];
      check(
        tiles.length === 5 &&
          tiles.every(
            (el) =>
              el.getBoundingClientRect().width === 36 &&
              el.getBoundingClientRect().height === 36,
          ),
        "Human/Agent/+ 必须均为36px",
      );
      const pictures = [
        ...document.querySelectorAll<HTMLElement>(
          ".rah-channel-member-avatars .rah-agent-avatar-grid",
        ),
      ].map((e) => e.innerHTML);
      check(
        new Set(pictures).size === 2,
        "两个旧Provider头像不得回退为同一robot",
      );
      button("添加成员")!.click();
      await frame();
      check(
        document.querySelector('[data-room-members-view="add"]'),
        "＋必须进入独立添加页面",
      );
      if (!document.querySelector('[data-room-members-view="add"]'))
        throw new Error("添加页面不存在");
      button("返回频道设置")!.click();
      await frame();
      check(
        document.querySelector('[data-room-members-view="settings"]'),
        "从＋进入后返回设置",
      );
      check(
        document.activeElement === button("添加成员"),
        "返回设置恢复＋焦点",
      );
      button("管理成员")!.click();
      await frame();
      check(
        document.querySelector('[data-room-members-view="members"]'),
        "人数摘要进入成员管理",
      );
      button("添加成员")!.click();
      await frame();
      button("返回成员管理")!.click();
      await frame();
      check(
        document.querySelector('[data-room-members-view="members"]'),
        "从成员页进入后返回成员页",
      );
      button("编辑 Reviewer 的角色")!.click();
      await frame();
      const roleSelect = document.querySelector<HTMLSelectElement>(
        '[aria-label="Reviewer 的角色"]',
      );
      check(roleSelect, "Human 角色编辑必须打开显式选择器");
      if (roleSelect) {
        roleSelect.value = "admin";
        roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      button("保存 Reviewer 的角色")!.click();
      for (let i = 0; i < 4; i++) await frame();
      check(
        [...document.querySelectorAll(".rah-room-member-entry")].some(
          (row) =>
            row.textContent?.includes("Reviewer") &&
            row.textContent?.includes("管理员"),
        ),
        "角色保存后必须投影 canonical 管理员徽标",
      );
      button("添加成员")!.click();
      await frame();
      button("选择 Grok")!.click();
      button("选择 Cindy")!.click();
      await frame();
      button("添加所选（2）")!.click();
      button("添加所选（2）")?.click();
      for (let i = 0; i < 20; i++) await frame();
      check(
        calls.current.filter((id) => id === "Grok").length === 1,
        "重复点击不能重复提交成功项",
      );
      check(button("添加所选（1）"), "批量部分失败只保留失败项");
      check(document.querySelector('[role="alert"]'), "部分失败必须显示错误");
      button("添加所选（1）")!.click();
      for (let i = 0; i < 20; i++) await frame();
      check(
        document.querySelector('[data-room-members-view="members"]'),
        "添加成功回来源成员页",
      );
      check(
        [
          ...document.querySelectorAll<HTMLElement>(
            ".rah-room-member-entry .rah-agent-avatar",
          ),
        ].every(
          (el) =>
            el.getBoundingClientRect().width === 28 &&
            el.getBoundingClientRect().height === 28,
        ),
        "成员管理头像不得被行布局拉伸，须为28px",
      );
      check(calls.current.join(",") === "Grok,Cindy,Cindy", "仅重试失败项");
      check(
        document.documentElement.scrollWidth <= innerWidth,
        "页面不得横向溢出",
      );
      button("返回频道设置")!.click();
      await frame();
      button("停止所有 Agent")!.click();
      await frame();
      check(
        document.querySelector('[aria-labelledby="rah-room-sos-title"]'),
        "Room SOS 必须先显示橙色确认层",
      );
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await frame();
      check(
        document.activeElement === button("停止所有 Agent"),
        "关闭 SOS 确认后必须把焦点还给触发按钮",
      );
      button("停止所有 Agent")!.click();
      await frame();
      button("立即停止")!.click();
      for (let i = 0; i < 4; i++) await frame();
      const guidance = document.querySelector<HTMLTextAreaElement>(
        '[aria-label="恢复 Agent 的纠正指导"]',
      );
      check(guidance, "停止完成后必须显示纠正指导输入框");
      check(
        document.activeElement === guidance,
        "停止完成后焦点必须进入指导输入框",
      );
      if (guidance) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(guidance, "按新的分工继续");
        guidance.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await frame();
      button("全部恢复")!.click();
      for (let i = 0; i < 4; i++) await frame();
      check(
        sosCalls.current.join(",") === "stop,resume:按新的分工继续",
        "恢复必须在停止完成后携带非空 guidance",
      );
      check(
        document.querySelector('[data-room-members-view="settings"]'),
        "恢复成功后只关闭 SOS 层并保留频道设置",
      );
      button("退出频道")!.click();
      await frame();
      check(
        document.querySelector('[aria-labelledby="rah-room-leave-title"]'),
        "退出频道必须先显示橙色确认层",
      );
      check(
        document.body.textContent?.includes("停止接收 #成员回归") &&
          document.body.textContent?.includes("的常规消息"),
        "确认层必须说明停止常规投递",
      );
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await frame();
      check(
        document.querySelector('[data-room-members-view="settings"]'),
        "Escape 只关闭顶层退出确认，保留频道设置",
      );
      check(
        document.activeElement === button("退出频道"),
        "关闭确认后必须把焦点还给退出按钮",
      );
      button("退出频道")!.click();
      await frame();
      button("离开")!.click();
      for (let i = 0; i < 4; i++) await frame();
      check(leaveCalls.current === 1, "退出确认只能提交一次");
      check(!document.querySelector('[role="dialog"]'), "成功后必须关闭设置");
    } catch (e) {
      failures.push(String(e));
    }
    setReport(
      JSON.stringify({
        result: failures.length ? "FAIL" : "PASS",
        failures,
        calls: calls.current,
      }),
    );
  }
  return (
    <>
      <aside
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: 1000,
          background: "white",
          maxWidth: 260,
        }}
      >
        <p>隔离 UI 回归：不连接daemon、不调用CLI</p>
        <button
          onClick={() => {
            calls.current = [];
            failCindy.current = true;
            void run();
          }}
        >
          运行成员回归
        </button>
        <button onClick={() => setOpen(true)}>重新打开设置</button>
        <output id="room-members-report">{report}</output>
      </aside>
      {open && (
        <RoomMembersDialog
          canAdd
          canLeave
          canManageRoles
          canRemove
          canStopAgents
          canUpdate
          room={archivedAt === undefined ? room : { ...room, archivedAt }}
          memberships={[
            {
              principalId: "owner",
              roomId: room.roomId,
              role: "owner",
              joinedAt: room.createdAt,
            },
            {
              principalId: reviewer.principalId,
              roomId: room.roomId,
              role: reviewerRole,
              joinedAt: room.createdAt,
            },
          ]}
          candidates={agents.map((a) => ({
            ...a,
            joined: joined.includes(a.participantId),
          }))}
          members={[
            human,
            reviewer,
            ...agents
              .filter((a) => joined.includes(a.participantId))
              .map((a): Principal => ({
                principalId: a.participantId,
                handle: a.handle,
                kind: "agent",
              })),
          ]}
          onClose={() => setOpen(false)}
          onLeave={async () => {
            leaveCalls.current += 1;
            setOpen(false);
          }}
          onStopAgents={async () => {
            sosCalls.current.push("stop");
          }}
          onResumeAgents={async (guidance) => {
            sosCalls.current.push(`resume:${guidance}`);
          }}
          onArchive={async () => setArchivedAt(new Date().toISOString())}
          onUnarchive={async () => setArchivedAt(undefined)}
          onUpdate={async () => {}}
          onAdd={async (a) => {
            calls.current.push(a.participantId);
            await frame();
            if (a.participantId === "Cindy" && failCindy.current) {
              failCindy.current = false;
              throw new Error("隔离测试：暂时无法添加 Cindy");
            }
            setJoined((ids) => [...new Set([...ids, a.participantId])]);
          }}
          onRemove={async (a) =>
            setJoined((ids) => ids.filter((id) => id !== a.participantId))
          }
          onRole={async (principalId, role) => {
            if (principalId !== reviewer.principalId || role === "owner") {
              throw new Error("隔离测试：非预期角色修改");
            }
            setReviewerRole(role);
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
