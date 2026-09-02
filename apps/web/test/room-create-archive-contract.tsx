import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";

import type { Room } from "@rah-os/protocol";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import "../src/agent-directory.css";
import { RoomCreateDialog } from "../src/components/room-dialogs.tsx";

const archivedRoom: Room = {
  archivedAt: "2026-09-02T00:00:00.000Z",
  createdAt: "2026-08-31T00:00:00.000Z",
  kind: "channel",
  name: "历史频道",
  roomId: "archived-room",
  slug: "历史频道",
  visibility: "public",
  workspaceId: "isolated-workspace",
};

const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function Fixture() {
  const [open, setOpen] = useState(true);
  const [report, setReport] = useState("等待开始");
  const calls = useRef<string[]>([]);

  async function run() {
    const failures: string[] = [];
    const check = (condition: unknown, message: string) => {
      if (!condition) failures.push(message);
    };
    try {
      flushSync(() => setOpen(false));
      flushSync(() => setOpen(true));
      await frame();
      const input = document.querySelector<HTMLInputElement>(
        ".rah-room-create-dialog input[required]",
      );
      if (input === null) throw new Error("找不到频道名称输入框");
      setInput(input, archivedRoom.name);
      await frame();
      button("创建频道")?.click();
      await frame();
      check(
        document.querySelector(".rah-room-create-archived-warning"),
        "同 slug 的已归档频道必须阻止重复创建并显示恢复说明",
      );
      check(button("取消归档"), "有管理权限时必须提供取消归档入口");
      check(button("修改名称"), "必须提供修改名称入口");
      check(calls.current.length === 0, "冲突时不得调用创建或恢复写入");

      button("修改名称")?.click();
      await frame();
      check(input.value === "", "修改名称应清空旧冲突名称");
      check(
        document.activeElement === input,
        "修改名称后焦点必须返回名称输入框",
      );
      check(
        document.querySelector(".rah-room-create-archived-warning") === null,
        "开始修改名称后应关闭冲突说明",
      );

      setInput(input, archivedRoom.name);
      await frame();
      button("创建频道")?.click();
      await frame();
      button("取消归档")?.click();
      for (let index = 0; index < 4; index += 1) await frame();
      check(
        calls.current.join(",") === archivedRoom.roomId,
        "取消归档必须携带被占用频道的 canonical roomId",
      );
      check(
        !open || document.querySelector('[role="dialog"]') === null,
        "恢复成功后关闭创建窗口",
      );
      check(
        document.documentElement.scrollWidth <= innerWidth,
        "恢复提示在窄屏不得造成横向溢出",
      );
    } catch (caught) {
      failures.push(String(caught));
    }
    setReport(
      JSON.stringify({
        calls: calls.current,
        failures,
        result: failures.length === 0 ? "PASS" : "FAIL",
      }),
    );
  }

  return (
    <>
      <aside
        style={{
          background: "white",
          left: 0,
          maxWidth: 280,
          position: "fixed",
          top: 0,
          zIndex: 1000,
        }}
      >
        <p>隔离 UI 回归：不连接 daemon、不调用 CLI</p>
        <button onClick={() => void run()}>运行归档恢复回归</button>
        <output id="room-create-archive-report">{report}</output>
      </aside>
      {open ? (
        <RoomCreateDialog
          agents={[]}
          archivedRooms={[archivedRoom]}
          canUnarchive
          onClose={() => setOpen(false)}
          onCreate={async () => calls.current.push("unexpected-create")}
          onUnarchive={async (room) => {
            calls.current.push(room.roomId);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
