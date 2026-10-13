import type { ConsoleContext } from "./context.ts";
import { button, el, field, labelled } from "./dom.ts";
import { disclosure } from "./presentation.ts";
import { errorText } from "./api.ts";
import { roleFormFrom } from "./actions.ts";
import { SESSION_RESET_CONSEQUENCE, type InstanceStatus } from "./model.ts";

/** Snapshot the choice when opened; polling and retries cannot change it. */
export function instanceRestartDialog(
  context: ConsoleContext,
  status: InstanceStatus,
  cancel: () => void,
  confirm: (revision?: string) => void,
): HTMLElement {
  const choice = el(
    "select",
    { className: "restart-config-choice", attrs: { "aria-label": "重启配置" } },
    [
      el("option", {
        text: "保留实例现有名称和配置（默认）",
        attrs: { value: "keep" },
      }),
    ],
  );
  const preview = el("div");
  const note = el("p", { className: "muted", text: "正在读取配置…" });
  const submit = button(
    "确认重置",
    () => confirm(choice.value === "keep" ? undefined : choice.value),
    { className: "danger confirm-reset" },
  );
  submit.disabled = true;
  const root = el(
    "div",
    {
      className: "confirm-box",
      attrs: { role: "alertdialog", "aria-label": "重启实例" },
    },
    [
      el("p", { text: SESSION_RESET_CONSEQUENCE }),
      labelled("重启配置", choice),
      note,
      preview,
      el("div", { className: "form-actions" }, [
        submit,
        button("取消", cancel, { className: "secondary confirm-cancel" }),
      ]),
    ],
  );
  const identity = context.identity;
  if (!identity) {
    note.textContent = "尚未连接";
    return root;
  }
  void Promise.all([
    context.client.request("role.list", {
      controlRoomId: identity.controlRoomId,
    }),
    context.client.request("agent.get", { agentId: status.agentId }),
    context.client.request("host.runtime.list", {}),
  ])
    .then(([catalog, current, inventory]) => {
      if (!root.isConnected) return;
      const latest = catalog.roles.find(
        (role) => role.roleId === status.roleId,
      );
      if (latest)
        choice.append(
          el("option", {
            text: `采用 ${latest.configuration.displayName} 最新配置`,
            attrs: { value: latest.roleRevisionId },
          }),
        );
      note.textContent = latest
        ? "采用最新配置会更新名称、Prompt、CLI、模型和推理强度；实例身份与历史保留。"
        : "原 Role 配置已删除；仍可保留现有配置重启。";
      const show = () => {
        const adopt = choice.value !== "keep" && latest;
        const revision = current.agent.currentRevision;
        const model = adopt
          ? adopt.configuration.modelIntent
          : current.policy.modelIntent;
        const offer = adopt
          ? adopt.configuration.runtimeOfferId
          : current.policy.required.allowedOfferIds?.[0];
        const runtime = inventory.runtimes.find(
          (r) => r.runtimeOfferId === offer,
        );
        preview.replaceChildren(
          field(
            "名称",
            adopt
              ? `${adopt.configuration.displayName} + 实例后缀`
              : current.agent.handle,
          ),
          field("CLI", runtime?.displayName ?? "已保存的 CLI（当前未发现）"),
          field("模型", model.exactBindingIds?.join(", ") ?? "CLI 默认"),
          field("推理强度", model.reasoning ?? "默认"),
          disclosure("角色 Prompt", [
            el("p", {
              className: "field-value",
              text: adopt
                ? roleFormFrom(adopt.configuration).instructions
                : (revision.instructions ?? ""),
            }),
          ]),
        );
      };
      choice.addEventListener("change", show);
      show();
      submit.disabled = false;
    })
    .catch((error) => {
      if (root.isConnected)
        note.textContent = `读取配置失败：${errorText(error)}。请取消后重新打开。`;
    });
  return root;
}
