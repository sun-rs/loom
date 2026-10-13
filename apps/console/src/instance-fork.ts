import type { ConsoleContext } from "./context.ts";
import type { InstanceStatus } from "./model.ts";
import { button, el } from "./dom.ts";
import { errorText } from "./api.ts";

/** Capability preview only; Kernel and Host independently enforce every condition. */
export function instanceForkDialog(
  context: ConsoleContext,
  status: InstanceStatus,
  cancel: () => void,
  confirm: () => void,
  side = false,
): HTMLElement {
  const note = el("p", { text: "正在核实原生 Fork 支持…" });
  const submit = button(side ? "打开 Side" : "创建分叉成员", confirm, {
    className: "confirm-fork",
  });
  submit.disabled = true;
  const root = el(
    "div",
    {
      className: "confirm-box",
      attrs: {
        role: "alertdialog",
        "aria-label": side ? "打开 Side" : "分叉实例",
      },
    },
    [
      el("p", {
        text: side
          ? "继承当前上下文，开启独立私有对话。Side 只能读取源频道消息和获准的记忆，不能发回频道或修改主会话；可随时请求丢弃，确认进程退出后关闭。CLI 文件访问仍沿用本机权限。"
          : "创建同 Role、同现有配置的新频道成员，并继承此刻的原生上下文。源实例保持不变；任务负责人和私聊权限不复制。",
      }),
      note,
      el("div", { className: "form-actions" }, [
        submit,
        button("取消", cancel, { className: "secondary confirm-cancel" }),
      ]),
    ],
  );
  void Promise.all([
    context.client.request("agent.get", { agentId: status.agentId }),
    context.client.request("host.runtime.list", {}),
  ])
    .then(([current, inventory]) => {
      if (!root.isConnected) return;
      const runtime = inventory.runtimes.find(
        (r) =>
          r.runtimeOfferId === current.policy.required.allowedOfferIds?.[0],
      );
      const supported =
        runtime?.sessionBranches?.includes(side ? "side" : "fork") === true &&
        runtime.available &&
        current.agent.currentRevision.executionWorkspace?.kind ===
          "channel_home";
      note.textContent = supported
        ? "源实例须空闲且已建立会话。复制本身不调用模型；新成员之后的对话正常计费。"
        : "此运行时尚未接入原生会话复制，或实例未使用共享频道目录。";
      submit.disabled = !supported;
    })
    .catch((error) => {
      if (root.isConnected) note.textContent = `无法核实：${errorText(error)}`;
    });
  return root;
}
