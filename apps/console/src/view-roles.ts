import {
  ActionGate,
  buildRoleConfiguration,
  runRoomAction,
  runtimeChoices,
  type RuntimeChoice,
} from "./actions.ts";
import { errorText, isAbort, roomSession } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import { button, el, field, labelled, setOptions, setStatus } from "./dom.ts";
import { Poller } from "./poll.ts";

const LIST_POLL_MS = 15_000;

/**
 * Minimal Role creation (batch 2). The CLI and model choices come only from
 * `host.runtime.list`: the console never guesses a binding id.
 */
export function mountRoles(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  const gate = new ActionGate();
  let choices: RuntimeChoice[] = [];
  const displayName = el("input", {
    attrs: { autocomplete: "off", id: "role-display-name" },
  });
  const handle = el("input", {
    attrs: { autocomplete: "off", id: "role-handle" },
  });
  const roleText = el("input", {
    attrs: { autocomplete: "off", id: "role-role" },
  });
  const instructions = el("textarea", {
    attrs: { id: "role-instructions", rows: "4" },
  });
  const runtime = el("select", { attrs: { id: "role-runtime" } });
  const binding = el("select", { attrs: { id: "role-binding" } });
  const reasoning = el("select", { attrs: { id: "role-reasoning" } });
  const inventoryStatus = el("p", {
    attrs: { id: "role-inventory-status" },
    className: "muted",
    text: "读取 CLI 目录中…",
  });
  const status = el("p", {
    attrs: { id: "role-create-status", role: "status" },
    className: "action-status",
  });
  const submit = el("button", {
    attrs: { id: "role-create-submit", type: "submit" },
    text: "创建 Role",
  });
  gate.onChange((pending) => {
    submit.disabled = pending;
    submit.textContent = pending ? "创建中…" : "创建 Role";
  });

  const syncBindings = () => {
    const current = choices.find(
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
  const syncReasoning = () => {
    const current = choices
      .find(({ runtimeOfferId }) => runtimeOfferId === runtime.value)
      ?.bindings.find(({ modelBindingId }) => modelBindingId === binding.value);
    const levels = current?.reasoning ?? [];
    setOptions(
      reasoning,
      levels.map((level) => ({ label: level, value: level })),
      levels.length === 0 ? "该模型未发布推理强度" : "选择推理强度",
    );
    reasoning.disabled = levels.length === 0;
  };
  runtime.addEventListener("change", syncBindings);
  binding.addEventListener("change", syncReasoning);

  const loadInventory = async () => {
    inventoryStatus.textContent = "读取 CLI 目录中…";
    try {
      const inventory = await context.client.request("host.runtime.list", {});
      choices = runtimeChoices(inventory);
      setOptions(
        runtime,
        choices.map(({ label, runtimeOfferId }) => ({
          label,
          value: runtimeOfferId,
        })),
        "选择 CLI",
      );
      syncBindings();
      inventoryStatus.textContent =
        choices.length === 0
          ? "Host 当前没有已发布的可用 CLI"
          : `Host 已发布 ${String(choices.length)} 个可用 CLI（只能选择目录中的模型）`;
    } catch (error) {
      inventoryStatus.textContent = `CLI 目录读取失败：${errorText(error)}`;
    }
  };

  const form = el("form", { attrs: { id: "role-create-form" } }, [
    labelled("显示名", displayName),
    labelled("handle", handle, "字母或数字开头，可含 . _ -"),
    labelled("职责（role）", roleText),
    labelled("指令（instructions）", instructions),
    labelled("CLI（runtimeOfferId）", runtime),
    labelled("模型（Host 目录发布的 binding）", binding),
    labelled("推理强度", reasoning),
    inventoryStatus,
    el("div", { className: "form-actions" }, [
      submit,
      button("刷新 CLI 目录", () => void loadInventory(), {
        attrs: { id: "role-inventory-refresh" },
        className: "secondary",
      }),
    ]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void gate
      .run(async () => {
        const identity = context.identity;
        if (identity === undefined) {
          setStatus(status, "error", "尚未连接，无法创建");
          return;
        }
        const configuration = buildRoleConfiguration(
          {
            displayName: displayName.value,
            handle: handle.value,
            instructions: instructions.value,
            modelBindingId: binding.value,
            reasoning: reasoning.value,
            role: roleText.value,
            runtimeOfferId: runtime.value,
          },
          choices,
        );
        if (!configuration.ok) {
          setStatus(status, "error", configuration.error);
          return;
        }
        setStatus(status, "info", "提交中…");
        try {
          const result = await runRoomAction({
            action: "role-create",
            session: roomSession(context.client, identity.controlRoomId),
            mutate: (basedOnRoomSeq, idempotencyKey) =>
              context.client.request("role.create", {
                basedOnRoomSeq,
                configuration: configuration.value,
                controlRoomId: identity.controlRoomId,
                idempotencyKey,
              }),
          });
          setStatus(
            status,
            "ok",
            `已创建 Role ${result.role.configuration.displayName}（${result.role.roleId}），可在频道页实例化`,
          );
          poller.runNow();
        } catch (error) {
          setStatus(status, "error", `创建失败：${errorText(error)}`);
        }
      })
      .catch(() => undefined);
  });

  const list = el("div", { attrs: { id: "role-list" } }, [
    el("p", { className: "muted", text: "加载中…" }),
  ]);
  container.replaceChildren(
    el("section", { className: "panel" }, [el("h2", { text: "Role" }), list]),
    el("section", { className: "panel" }, [
      el("h2", { text: "创建 Role（最小）" }),
      el("p", {
        className: "muted",
        text: "每次保存都是新的不可变修订；已有实例不随之改变。",
      }),
      form,
    ]),
  );

  const poller = new Poller(LIST_POLL_MS, async (signal) => {
    const identity = context.identity;
    if (identity === undefined) return;
    try {
      const roles = await context.client.request(
        "role.list",
        { controlRoomId: identity.controlRoomId },
        { signal },
      );
      if (signal.aborted) return;
      list.replaceChildren(
        roles.roles.length === 0
          ? el("p", { className: "muted", text: "还没有 Role" })
          : el(
              "ul",
              { className: "role-list" },
              roles.roles.map((role) => {
                const intent = role.configuration.modelIntent;
                const instances = roles.instances.filter(
                  ({ roleId }) => roleId === role.roleId,
                ).length;
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
                    field("Role", role.roleId),
                    field("当前修订", role.roleRevisionId),
                    field("CLI", role.configuration.runtimeOfferId),
                    field(
                      "模型",
                      `${intent.exactBindingIds?.join(", ") ?? "未指定"} · ${intent.reasoning ?? "未指定强度"}`,
                    ),
                    field("实例数", String(instances)),
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
