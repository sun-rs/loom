import type { RuntimeSettings } from "@rah-os/protocol";

import {
  ActionGate,
  buildSettingsUpdate,
  isSettingsConflict,
  settingsFormFrom,
  type SettingsForm,
} from "./actions.ts";
import { errorText, isAbort } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { button, el, field, labelled, setStatus } from "./dom.ts";
import { settingsRows } from "./model.ts";
import { Poller } from "./poll.ts";

const LIST_POLL_MS = 15_000;

type ScalarKey = Exclude<keyof SettingsForm, "runtimes">;

const SCALAR_FIELDS: ReadonlyArray<{
  hint?: string;
  key: ScalarKey;
  label: string;
}> = [
  { key: "maxConcurrentRuns", label: "本机同时运行上限（1–64）" },
  { key: "maxConcurrentStarts", label: "同时启动上限（1–64）" },
  { key: "minStartIntervalMs", label: "启动最小间隔（毫秒，0–60000）" },
  {
    hint: "Human 发言后，实例之间连续互相唤醒的上限",
    key: "wakeChainLimit",
    label: "实例互相唤醒上限（1–1000）",
  },
  { key: "noProgressWarnMinutes", label: "无进展告警阈值（分钟）" },
  {
    key: "queuedStallTerminateMinutes",
    label: "排队时无进展终止阈值（分钟）",
  },
  { key: "maxRunMinutes", label: "单次运行时长上限（分钟）" },
];

export function mountSettings(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  const gate = new ActionGate();
  const body = el("div", { attrs: { id: "runtime-settings" } }, [
    el("p", { className: "muted", text: "加载中…" }),
  ]);
  const staleNotice = el("p", {
    attrs: { id: "settings-stale", role: "status" },
    className: "action-status",
  });
  const status = el("p", {
    attrs: { id: "settings-status", role: "status" },
    className: "action-status",
  });
  const fields = el("div", { attrs: { id: "settings-fields" } });
  const baseLabel = el("p", {
    attrs: { id: "settings-base" },
    className: "muted",
  });
  const submit = el("button", {
    attrs: { id: "settings-submit", type: "submit" },
    text: "保存",
  });
  const inputs = new Map<ScalarKey, HTMLInputElement>();
  const runtimeInputs = new Map<string, HTMLInputElement>();
  let base: RuntimeSettings | undefined;
  let latest: RuntimeSettings | undefined;

  const renderRows = (settings: RuntimeSettings) => {
    body.replaceChildren(
      ...settingsRows(settings).map(({ label, value }) => field(label, value)),
    );
  };
  const fillForm = (settings: RuntimeSettings) => {
    base = settings;
    const values = settingsFormFrom(settings);
    inputs.clear();
    runtimeInputs.clear();
    const input = (id: string, value: string) =>
      el("input", {
        attrs: { id, inputmode: "decimal", value },
      });
    fields.replaceChildren(
      ...SCALAR_FIELDS.map(({ hint, key, label }) => {
        const control = input(`settings-${key}`, values[key]);
        inputs.set(key, control);
        return labelled(label, control, hint);
      }),
      ...settings.runtimes.map((runtime) => {
        const control = input(
          `settings-runtime-${runtime.runtimeProfileId}`,
          values.runtimes[runtime.runtimeProfileId] ?? "",
        );
        control.setAttribute(
          "data-runtime-profile-id",
          runtime.runtimeProfileId,
        );
        runtimeInputs.set(runtime.runtimeProfileId, control);
        return labelled(
          `CLI ${runtime.runtimeProfileId} 同时运行上限（供给上限 ${String(runtime.offerMaxConcurrent)}）`,
          control,
        );
      }),
    );
    baseLabel.textContent = `表单基于修订 ${String(settings.revision)}`;
    renderStale();
  };
  const renderStale = () => {
    if (
      base !== undefined &&
      latest !== undefined &&
      latest.revision !== base.revision
    ) {
      setStatus(
        staleNotice,
        "info",
        `设置已在别处更新为修订 ${String(latest.revision)}；以修订 ${String(base.revision)} 提交会被拒绝，请先重新读取`,
      );
    } else {
      staleNotice.textContent = "";
      staleNotice.className = "action-status";
    }
  };

  const read = async (signal?: AbortSignal) =>
    await context.client.request(
      "runtime.settings.read",
      {},
      signal === undefined ? undefined : { signal },
    );
  const reload = async () => {
    try {
      const settings = await read();
      latest = settings;
      renderRows(settings);
      fillForm(settings);
      return settings;
    } catch (error) {
      setStatus(status, "error", `运行设置读取失败：${errorText(error)}`);
      return undefined;
    }
  };

  gate.onChange((pending) => {
    submit.disabled = pending;
    submit.textContent = pending ? "保存中…" : "保存";
  });
  const form = el("form", { attrs: { id: "settings-form" } }, [
    el("p", {
      className: "muted",
      text: "修改只影响之后的调度决定；正在运行的工作不会被中断。",
    }),
    baseLabel,
    staleNotice,
    fields,
    el("div", { className: "form-actions" }, [
      submit,
      button(
        "重新读取",
        () => {
          void reload().then((settings) => {
            if (settings !== undefined) {
              setStatus(
                status,
                "info",
                `已重新读取修订 ${String(settings.revision)}`,
              );
            }
          });
        },
        { attrs: { id: "settings-reload" }, className: "secondary" },
      ),
    ]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void gate
      .run(async () => {
        if (base === undefined) {
          setStatus(status, "error", "设置尚未读取");
          return;
        }
        const values: SettingsForm = {
          ...settingsFormFrom(base),
          runtimes: Object.fromEntries(
            [...runtimeInputs].map(([id, input]) => [id, input.value]),
          ),
        };
        for (const [key, input] of inputs) values[key] = input.value;
        const update = buildSettingsUpdate(base, values);
        if (!update.ok) {
          setStatus(status, "error", update.error);
          return;
        }
        setStatus(status, "info", "提交中…");
        try {
          const saved = await context.client.request(
            "runtime.settings.update",
            update.value,
          );
          latest = saved;
          renderRows(saved);
          fillForm(saved);
          setStatus(
            status,
            "ok",
            `已保存为修订 ${String(saved.revision)}（只影响之后的调度）`,
          );
        } catch (error) {
          if (isSettingsConflict(error)) {
            const submitted = base.revision;
            const settings = await reload();
            setStatus(
              status,
              "error",
              `修订冲突：${errorText(error)}。表单基于修订 ${String(submitted)}，已重新读取修订 ${settings === undefined ? "（读取失败）" : String(settings.revision)}，请确认后再提交`,
            );
            return;
          }
          setStatus(status, "error", `保存失败：${errorText(error)}`);
        }
      })
      .catch(() => undefined);
  });

  container.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { text: "运行设置（当前值）" }),
      body,
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "修改运行设置" }),
      form,
    ]),
  );
  const poller = new Poller(LIST_POLL_MS, async (signal) => {
    try {
      const settings = await read(signal);
      if (signal.aborted) return;
      latest = settings;
      renderRows(settings);
      // The form keeps its base revision; a newer server revision is shown,
      // never silently merged into what the Human is editing.
      if (base === undefined) fillForm(settings);
      else renderStale();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      body.replaceChildren(
        el("p", {
          className: "error",
          text: `运行设置读取失败：${errorText(error)}`,
        }),
      );
    }
  });
  poller.start();
  return () => poller.stop();
}
