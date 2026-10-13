import type { RoleTemplate } from "@rah-os/protocol";
import { WriteIntentSlot } from "./actions.ts";
import { roomSession } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { button, el, setStatus } from "./dom.ts";
import { intentControls, reportOutcome } from "./intent-view.ts";

/** A single frozen deletion intent survives list refreshes and unknown results. */
export function roleDelete(context: ConsoleContext, changed: () => void) {
  const slot = new WriteIntentSlot();
  let target: RoleTemplate | undefined;
  const status = el("p", { attrs: { role: "status" } });
  const explanation = el("p");
  const panel = el("section", {
    className: "panel",
    attrs: { hidden: "", id: "role-delete-confirm" },
  });
  const cancel = button("取消", () => {
    panel.hidden = true;
    target = undefined;
  });
  const confirm = button(
    "确认删除角色",
    () => {
      if (!target || slot.state !== "idle") return;
      void slot
        .submit({
          action: "role-delete",
          payload: {
            roleId: target.roleId,
            expectedRoleRevisionId: target.roleRevisionId,
          },
          session: roomSession(context.client, target.controlRoomId),
          send: (payload, basedOnRoomSeq, idempotencyKey) =>
            context.client.request("role.delete", {
              ...payload,
              basedOnRoomSeq,
              idempotencyKey,
            }),
          onSettled: (outcome) =>
            reportOutcome(status, outcome, "删除被拒绝", () => {
              panel.hidden = true;
              target = undefined;
              changed();
            }),
        })
        .catch(() => undefined);
    },
    { className: "danger" },
  );
  slot.onChange((state) => {
    cancel.disabled = confirm.disabled = state !== "idle";
  });
  panel.append(
    explanation,
    confirm,
    cancel,
    status,
    intentControls(slot, "role-delete", status),
  );
  return {
    panel,
    open(role: RoleTemplate) {
      if (slot.state !== "idle") {
        panel.hidden = false;
        return;
      }
      target = role;
      explanation.textContent = `删除角色“${role.configuration.displayName}”？已有实例、对话和配置快照继续保留。以后新建同名角色属于新的身份。`;
      setStatus(status, "info", "");
      panel.hidden = false;
      confirm.focus();
    },
  };
}
