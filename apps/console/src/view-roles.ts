import type { RoleListResponse } from "@rah-os/protocol";

import {
  WriteIntentSlot,
  buildRoleConfiguration,
  roleFormFrom,
  runtimeChoices,
  type RoleForm,
  type RuntimeChoice,
} from "./actions.ts";
import { errorText, isAbort, roomSession } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import { button, el, field, labelled, setOptions, setStatus } from "./dom.ts";
import {
  INTENT_BUSY_UNKNOWN,
  intentControls,
  reportOutcome,
} from "./intent-view.ts";
import { disclosure, friendlyCli, isTestRecord } from "./presentation.ts";
import { Poller } from "./poll.ts";

const LIST_POLL_MS = 15_000;

type Role = RoleListResponse["roles"][number];

/**
 * The editable Role fields. CLI, model and reasoning choices come only from
 * the Host catalog (`host.runtime.list`): the console never guesses a
 * binding id, and a binding the Host no longer publishes cannot be kept.
 */
function roleFields(prefix: string, choices: () => RuntimeChoice[]) {
  const displayName = el("input", {
    attrs: { autocomplete: "off", id: `${prefix}-display-name` },
  });
  const handle = el("input", {
    attrs: { autocomplete: "off", id: `${prefix}-handle` },
  });
  const roleText = el("input", {
    attrs: { autocomplete: "off", id: `${prefix}-role` },
  });
  const instructions = el("textarea", {
    attrs: { id: `${prefix}-instructions`, rows: "4" },
  });
  const runtime = el("select", { attrs: { id: `${prefix}-runtime` } });
  const binding = el("select", { attrs: { id: `${prefix}-binding` } });
  const reasoning = el("select", { attrs: { id: `${prefix}-reasoning` } });
  const syncReasoning = () => {
    const current = choices()
      .find(({ runtimeOfferId }) => runtimeOfferId === runtime.value)
      ?.bindings.find(({ modelBindingId }) => modelBindingId === binding.value);
    const levels = current?.reasoning ?? [];
    setOptions(
      reasoning,
      levels.map((level) => ({ label: level, value: level })),
      levels.length === 0 ? "该模型未发布推理强度" : "选择推理强度",
    );
    reasoning.disabled = levels.length === 0 || locked;
  };
  const syncBindings = () => {
    const current = choices().find(
      ({ runtimeOfferId }) => runtimeOfferId === runtime.value,
    );
    setOptions(
      binding,
      (current?.bindings ?? []).map(({ label, modelBindingId }) => ({
        label,
        value: modelBindingId,
      })),
      "选择模型",
    );
    syncReasoning();
  };
  const syncRuntimes = () => {
    setOptions(
      runtime,
      choices().map(({ label, runtimeOfferId }) => ({
        label,
        value: runtimeOfferId,
      })),
      "选择 CLI",
    );
    syncBindings();
  };
  runtime.addEventListener("change", syncBindings);
  binding.addEventListener("change", syncReasoning);
  const controls = [
    displayName,
    handle,
    roleText,
    instructions,
    runtime,
    binding,
    reasoning,
  ];
  let locked = false;
  return {
    elements: [
      labelled("显示名", displayName),
      labelled("handle", handle, "字母或数字开头，可含 . _ -"),
      labelled("职责简介", roleText),
      labelled("详细指令", instructions),
      labelled("CLI", runtime),
      labelled("模型", binding),
      labelled("推理强度", reasoning),
    ],
    fill: (form: RoleForm) => {
      displayName.value = form.displayName;
      handle.value = form.handle;
      roleText.value = form.role;
      instructions.value = form.instructions;
      syncRuntimes();
      runtime.value = form.runtimeOfferId;
      syncBindings();
      binding.value = form.modelBindingId;
      syncReasoning();
      reasoning.value = form.reasoning;
    },
    /** Frozen while an intent is pending or unknown. */
    lock: (value: boolean) => {
      locked = value;
      for (const control of controls) control.disabled = value;
      if (!value) syncReasoning();
    },
    read: (): RoleForm => ({
      displayName: displayName.value,
      handle: handle.value,
      instructions: instructions.value,
      modelBindingId: binding.value,
      reasoning: reasoning.value,
      role: roleText.value,
      runtimeOfferId: runtime.value,
    }),
    syncRuntimes,
  };
}

/** Minimal Role creation and revision (batches 2 and 3). */
export function mountRoles(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  let choices: RuntimeChoice[] = [];
  let roles: Role[] = [];
  const inventoryStatus = el("p", {
    attrs: { id: "role-inventory-status" },
    className: "muted",
    text: "读取 CLI 目录中…",
  });

  // --- Create ---
  const createSlot = new WriteIntentSlot();
  const createFields = roleFields("role", () => choices);
  const status = el("p", {
    attrs: { id: "role-create-status", role: "status" },
    className: "action-status",
  });
  const submit = el("button", {
    attrs: { id: "role-create-submit", type: "submit" },
    text: "创建 Role",
  });
  createSlot.onChange((state) => {
    submit.disabled = state !== "idle";
    submit.textContent = state === "pending" ? "创建中…" : "创建 Role";
    createFields.lock(state !== "idle");
  });

  // --- Revise ---
  const reviseSlot = new WriteIntentSlot();
  const reviseFields = roleFields("role-revise", () => choices);
  let revising: Role | undefined;
  const reviseTarget = el("p", {
    attrs: { id: "role-revise-target" },
    className: "muted",
    text: "在上方列表中选择一个 Role 的“修订…”",
  });
  const reviseStatus = el("p", {
    attrs: { id: "role-revise-status", role: "status" },
    className: "action-status",
  });
  const reviseSubmit = el("button", {
    attrs: { id: "role-revise-submit", type: "submit" },
    text: "保存为新修订",
  });
  reviseSubmit.disabled = true;
  reviseSlot.onChange((state) => {
    reviseSubmit.disabled = state !== "idle" || revising === undefined;
    reviseSubmit.textContent = state === "pending" ? "保存中…" : "保存为新修订";
    reviseFields.lock(state !== "idle");
  });
  const startRevision = (role: Role) => {
    if (reviseSlot.state !== "idle") {
      setStatus(reviseStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    revisePanel.hidden = false;
    revising = role;
    reviseTarget.textContent = `修订 ${role.configuration.displayName}（${role.roleId}），基于修订 ${role.roleRevisionId}；已有实例保持原快照，显示为“Role 已有新修订”。`;
    reviseFields.fill(roleFormFrom(role.configuration));
    reviseSubmit.disabled = false;
    setStatus(reviseStatus, "info", "");
  };

  const loadInventory = async () => {
    inventoryStatus.textContent = "读取 CLI 目录中…";
    try {
      const inventory = await context.client.request("host.runtime.list", {});
      choices = runtimeChoices(inventory);
      createFields.syncRuntimes();
      if (revising !== undefined && reviseSlot.state === "idle") {
        reviseFields.fill(reviseFields.read());
      }
      inventoryStatus.textContent =
        choices.length === 0
          ? "Host 当前没有已发布的可用 CLI"
          : `Host 已发布 ${String(choices.length)} 个可用 CLI（只能选择目录中的模型）`;
    } catch (error) {
      inventoryStatus.textContent = `CLI 目录读取失败：${errorText(error)}`;
    }
  };

  const form = el("form", { attrs: { id: "role-create-form" } }, [
    ...createFields.elements,
    inventoryStatus,
    el("div", { className: "form-actions" }, [
      submit,
      button("刷新 CLI 目录", () => void loadInventory(), {
        attrs: { id: "role-inventory-refresh" },
        className: "secondary",
      }),
    ]),
    status,
    intentControls(createSlot, "role-create", status),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (createSlot.state === "unknown") {
      setStatus(status, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (createSlot.state === "pending") return;
    const identity = context.identity;
    if (identity === undefined) {
      setStatus(status, "error", "尚未连接，无法创建");
      return;
    }
    const configuration = buildRoleConfiguration(createFields.read(), choices);
    if (!configuration.ok) {
      setStatus(status, "error", configuration.error);
      return;
    }
    setStatus(status, "info", "提交中…");
    void createSlot
      .submit({
        action: "role-create",
        payload: {
          configuration: configuration.value,
          controlRoomId: identity.controlRoomId,
        },
        session: roomSession(context.client, identity.controlRoomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("role.create", {
            basedOnRoomSeq,
            configuration: structuredClone(payload.configuration),
            controlRoomId: payload.controlRoomId,
            idempotencyKey,
          }),
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "创建失败", (result) => {
            setStatus(
              status,
              "ok",
              `已创建 Role ${result.role.configuration.displayName}（${result.role.roleId}），可在频道页实例化${result.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
            );
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  });

  const reviseForm = el("form", { attrs: { id: "role-revise-form" } }, [
    reviseTarget,
    ...reviseFields.elements,
    el("div", { className: "form-actions" }, [reviseSubmit]),
    reviseStatus,
    intentControls(reviseSlot, "role-revise", reviseStatus),
  ]);
  reviseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (reviseSlot.state === "unknown") {
      setStatus(reviseStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    const base = revising;
    const identity = context.identity;
    if (reviseSlot.state === "pending" || base === undefined) return;
    if (identity === undefined) {
      setStatus(reviseStatus, "error", "尚未连接，无法修订");
      return;
    }
    const configuration = buildRoleConfiguration(
      reviseFields.read(),
      choices,
      base.configuration,
    );
    if (!configuration.ok) {
      setStatus(reviseStatus, "error", configuration.error);
      return;
    }
    setStatus(reviseStatus, "info", "提交中…");
    void reviseSlot
      .submit({
        action: "role-revise",
        payload: {
          configuration: configuration.value,
          expectedRoleRevisionId: base.roleRevisionId,
          roleId: base.roleId,
        },
        session: roomSession(context.client, identity.controlRoomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("role.revise", {
            basedOnRoomSeq,
            configuration: structuredClone(payload.configuration),
            expectedRoleRevisionId: payload.expectedRoleRevisionId,
            idempotencyKey,
            roleId: payload.roleId,
          }),
        onSettled: (outcome) => {
          reportOutcome(reviseStatus, outcome, "修订被拒绝", (result) => {
            revising = result.role;
            reviseTarget.textContent = `已保存 ${result.role.configuration.displayName} 的新修订 ${result.role.roleRevisionId}；已有实例保持原快照。`;
            setStatus(
              reviseStatus,
              "ok",
              `已保存为修订 ${result.role.roleRevisionId}${result.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
            );
            poller.runNow();
          });
          if (outcome.kind === "rejected") {
            setStatus(
              reviseStatus,
              "error",
              `修订被拒绝：${errorText(outcome.error)}。若 Role 已在别处修订，请重新选择“修订…”读取最新修订。`,
            );
          }
        },
      })
      .catch(() => undefined);
  });

  const list = el("div", { attrs: { id: "role-list" } }, [
    el("p", { className: "muted", text: "加载中…" }),
  ]);
  const revisePanel = el(
    "section",
    { className: "panel", attrs: { hidden: "" } },
    [
      el("h2", { text: "编辑角色" }),
      el("p", {
        className: "muted",
        text: "修改用于之后创建的实例，已有实例保持原配置。",
      }),
      reviseForm,
    ],
  );
  const showTests = el("input", {
    attrs: { type: "checkbox", id: "show-test-roles" },
  });
  container.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { text: "角色" }),
      labelled("显示测试 / 验收记录（按名称筛选）", showTests),
      list,
    ]),
    revisePanel,
    disclosure("创建角色", [form], "role-create"),
  );

  const poller = new Poller(LIST_POLL_MS, async (signal) => {
    const identity = context.identity;
    if (identity === undefined) return;
    try {
      const response = await context.client.request(
        "role.list",
        { controlRoomId: identity.controlRoomId },
        { signal },
      );
      if (signal.aborted) return;
      roles = response.roles;
      const visibleRoles = roles.filter(
        (role) =>
          showTests.checked || !isTestRecord(role.configuration.displayName),
      );
      list.replaceChildren(
        visibleRoles.length === 0
          ? el("p", {
              className: "muted",
              text:
                roles.length === 0
                  ? "还没有角色，创建一个开始协作。"
                  : "测试角色已收起，可以创建自己的角色。",
            })
          : el(
              "ul",
              { className: "role-list" },
              visibleRoles.map((role) => {
                const intent = role.configuration.modelIntent;
                const instances = response.instances.filter(
                  ({ roleId }) => roleId === role.roleId,
                );
                const stale = instances.filter(({ isCurrent }) => !isCurrent);
                return el(
                  "li",
                  {
                    attrs: { "data-role-id": role.roleId },
                    className: "role-card",
                  },
                  [
                    el("strong", { text: role.configuration.displayName }),
                    el("span", {
                      className: "muted",
                      text: ` @${role.configuration.handle}`,
                    }),
                    field(
                      "CLI",
                      friendlyCli(role.configuration.runtimeOfferId),
                    ),
                    disclosure("技术详情", [
                      field("Role", role.roleId),
                      field("当前修订", role.roleRevisionId, "role-revision"),
                    ]),
                    field(
                      "模型",
                      `${intent.exactBindingIds?.join(", ") ?? "未指定"} · ${intent.reasoning ?? "未指定强度"}`,
                      "role-model",
                    ),
                    field(
                      "实例数",
                      stale.length === 0
                        ? String(instances.length)
                        : `${String(instances.length)}（${String(stale.length)} 个仍用旧修订）`,
                      "role-instances",
                    ),
                    el("div", { className: "form-actions" }, [
                      button("修订…", () => startRevision(role), {
                        className: "secondary role-revise-open",
                      }),
                    ]),
                  ],
                );
              }),
            ),
      );
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      list.replaceChildren(
        el("p", {
          className: "error",
          text: `Role 读取失败：${errorText(error)}`,
        }),
      );
    }
  });
  void loadInventory();
  showTests.addEventListener("change", () => poller.runNow());
  poller.start();
  let hadIdentity = context.identity !== undefined;
  const unsubscribe = subscribe(context, () => {
    if (!hadIdentity && context.identity !== undefined) {
      hadIdentity = true;
      poller.runNow();
    }
  });
  return () => {
    unsubscribe();
    poller.stop();
  };
}
