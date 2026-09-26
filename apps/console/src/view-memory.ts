/**
 * Channel memory panel (S6 batch B): the channel's platform memory index,
 * body and revision history, Human changes, read/write switches and the
 * one-off legacy import. Every write is a WriteIntentSlot revisioned intent
 * (frozen payload, one idempotency key, unknown -> verify/abandon); a
 * revision mismatch (409) is shown and the view re-reads. The Kernel owns
 * every state; nothing here is inferred. Throwaway: deleted in phase 4.
 */
import type {
  MemoryEntry,
  MemoryEntryDetail,
  MemoryHistoryResponse,
  MemoryPolicy,
} from "@rah-os/protocol";

import { WriteIntentSlot, type IntentOutcome } from "./actions.ts";
import { errorText, isAbort } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import {
  button,
  el,
  field,
  labelled,
  localTime,
  present,
  setStatus,
} from "./dom.ts";
import {
  INTENT_BUSY_UNKNOWN,
  intentControls,
  reportOutcome,
} from "./intent-view.ts";
import {
  MEMORY_IMPORT_NOTE,
  accessLabel,
  buildImportRequest,
  buildMemoryChange,
  buildPolicyUpdate,
  deleteConfirmText,
  importResultLabel,
  isRevisionConflict,
  memoryOpLabel,
  memoryStateLabel,
  policyFormFrom,
  provenanceLabel,
  sendMemoryChange,
  type AccessChoice,
  type MemoryChangeKind,
  type PolicyForm,
} from "./memory.ts";
import { createMemoryDetailLoader } from "./memory-detail.ts";
import { Poller } from "./poll.ts";

const MEMORY_POLL_MS = 10_000;
const LIST_LIMIT = 200;

export type MemoryInstance = {
  instanceId: string;
  label: string;
  member: boolean;
};

export type MemoryPanel = {
  element: HTMLElement;
  setInstances: (instances: readonly MemoryInstance[]) => void;
  stop: () => void;
};

function statusLine(id: string): HTMLParagraphElement {
  return el("p", { attrs: { id, role: "status" }, className: "action-status" });
}

function choiceSelect(
  className: string,
  value: AccessChoice,
  label: string,
): HTMLSelectElement {
  const select = el("select", { attrs: { "aria-label": label }, className }, [
    el("option", { attrs: { value: "inherit" }, text: "继承默认" }),
    el("option", { attrs: { value: "on" }, text: "开" }),
    el("option", { attrs: { value: "off" }, text: "关" }),
  ]);
  select.value = value;
  return select;
}

function booleanSelect(id: string, value: boolean): HTMLSelectElement {
  const select = el("select", { attrs: { id } }, [
    el("option", { attrs: { value: "on" }, text: "开" }),
    el("option", { attrs: { value: "off" }, text: "关" }),
  ]);
  select.value = value ? "on" : "off";
  return select;
}

export function memoryPanel(
  context: ConsoleContext,
  channelId: string,
): MemoryPanel {
  let instances: readonly MemoryInstance[] = [];
  const instanceLabel = (instanceId: string): string =>
    instances.find((item) => item.instanceId === instanceId)?.label ??
    instanceId;

  // ------------------------------------------------------------------ list
  const includeInvalidated = el("input", {
    attrs: { id: "memory-include-invalidated", type: "checkbox" },
  });
  const includeDeleted = el("input", {
    attrs: { id: "memory-include-deleted", type: "checkbox" },
  });
  const searchInput = el("input", {
    attrs: {
      id: "memory-search",
      placeholder: "检索记忆（名称、描述与正文）",
      type: "search",
    },
  });
  const listStatus = statusLine("memory-list-status");
  const list = el("ul", {
    attrs: { id: "memory-list" },
    className: "memory-list",
  });
  let searchQuery = "";
  let entries: MemoryEntry[] = [];
  /** Author provenance per entry, cached by revision (read on demand). */
  const details = new Map<string, MemoryEntryDetail | string>();
  let selectedId: string | undefined;

  const detailKey = (entry: { entryId: string; revision: number }) =>
    `${entry.entryId}@${String(entry.revision)}`;

  const renderList = () => {
    list.replaceChildren(
      ...(entries.length === 0
        ? [
            el("li", {
              className: "muted",
              text: searchQuery === "" ? "没有记忆" : "没有匹配的记忆",
            }),
          ]
        : entries.map((entry) => {
            const detail = details.get(detailKey(entry));
            return el(
              "li",
              {
                attrs: {
                  "data-entry-id": entry.entryId,
                  "data-revision": String(entry.revision),
                  "data-state": entry.state,
                },
                className: `memory-entry state-${entry.state}${entry.entryId === selectedId ? " is-selected" : ""}`,
              },
              [
                el("div", { className: "memory-entry-head" }, [
                  button(entry.name, () => void select(entry.entryId), {
                    className: "secondary memory-open",
                  }),
                  el("span", {
                    className: "memory-state",
                    text: memoryStateLabel(entry.state),
                  }),
                  entry.pinned
                    ? el("span", { className: "memory-pinned", text: "置顶" })
                    : null,
                ]),
                field("类型", entry.type, "memory-type"),
                field("描述", entry.description, "memory-description"),
                field("修订", String(entry.revision), "memory-revision"),
                field("最近更新", localTime(entry.updatedAt), "memory-updated"),
                field(
                  "作者",
                  detail === undefined
                    ? "读取中…"
                    : typeof detail === "string"
                      ? detail
                      : provenanceLabel(detail.provenance, instanceLabel),
                  "memory-author",
                ),
              ],
            );
          })),
    );
  };

  const loadAuthors = async (signal?: AbortSignal) => {
    const missing = entries.filter((entry) => !details.has(detailKey(entry)));
    await Promise.all(
      missing.map(async (entry) => {
        try {
          const read = await context.client.request(
            "memory.read",
            { entryId: entry.entryId },
            signal === undefined ? undefined : { signal },
          );
          details.set(detailKey(read.entry), read.entry);
          if (read.entry.revision !== entry.revision) {
            // The listed revision is already superseded; never attribute
            // the newer author to it.
            details.set(detailKey(entry), "已有更新的修订，刷新列表后显示");
          }
        } catch (error) {
          if (signal?.aborted === true || isAbort(error)) return;
          details.set(detailKey(entry), `读取失败：${errorText(error)}`);
        }
      }),
    );
  };

  let listGeneration = 0;
  const loadList = async (signal?: AbortSignal) => {
    const options = signal === undefined ? undefined : { signal };
    listGeneration += 1;
    const generation = listGeneration;
    // An older response never overwrites a newer read.
    const superseded = () =>
      signal?.aborted === true || generation !== listGeneration;
    try {
      if (searchQuery !== "") {
        const found = await context.client.request(
          "memory.search",
          { channelId, query: searchQuery },
          options,
        );
        if (superseded()) return;
        entries = found.entries;
        setStatus(
          listStatus,
          "info",
          `检索“${found.query}”：${String(found.entries.length)} 条${found.truncated ? "（已截断）" : ""}`,
        );
      } else {
        const listed = await context.client.request(
          "memory.list",
          {
            channelId,
            includeDeleted: includeDeleted.checked,
            includeInvalidated: includeInvalidated.checked,
            limit: LIST_LIMIT,
          },
          options,
        );
        if (superseded()) return;
        entries = listed.entries;
        setStatus(
          listStatus,
          "info",
          `共 ${String(listed.total)} 条，显示 ${String(listed.entries.length)} 条${listed.truncated ? "（已截断）" : ""}`,
        );
      }
      renderList();
      await loadAuthors(signal);
      if (superseded()) return;
      renderList();
      renderDetailStale();
    } catch (error) {
      if (superseded() || isAbort(error)) return;
      entries = [];
      renderList();
      setStatus(listStatus, "error", `频道记忆读取失败：${errorText(error)}`);
    }
  };

  // ---------------------------------------------------------------- detail
  const entrySlot = new WriteIntentSlot();
  const detailBox = el("div", {
    attrs: { id: "memory-detail" },
    className: "memory-detail",
  });
  const detailStale = statusLine("memory-detail-stale");
  const actionStatus = statusLine("memory-action-status");
  const reasonInput = el("input", {
    attrs: { id: "memory-reason", placeholder: "失效原因（必填）" },
  });
  const deleteArea = el("div", { attrs: { id: "memory-delete-area" } });
  let current: MemoryEntryDetail | undefined;
  let history: MemoryHistoryResponse | undefined;
  detailBox.hidden = true;

  const renderDetailStale = () => {
    const listed = entries.find((entry) => entry.entryId === current?.entryId);
    if (
      current !== undefined &&
      listed !== undefined &&
      listed.revision !== current.revision
    ) {
      setStatus(
        detailStale,
        "info",
        `该记忆已更新为修订 ${String(listed.revision)}；当前显示修订 ${String(current.revision)}，以它提交会被拒绝，请先重新打开`,
      );
    } else {
      detailStale.textContent = "";
      detailStale.className = "action-status";
    }
  };

  const changeButton = (label: string, id: string, onClick: () => void) =>
    button(label, onClick, { attrs: { id }, className: "secondary" });

  const renderDetail = () => {
    if (current === undefined) {
      detailBox.hidden = true;
      return;
    }
    const entry = current;
    detailBox.hidden = false;
    const busy = entrySlot.state !== "idle" || !detailLoader.state().actionable;
    const actions: HTMLElement[] = [];
    if (entry.state !== "deleted") {
      actions.push(
        changeButton(
          entry.pinned ? "取消置顶" : "置顶",
          "memory-pin",
          () => void change(entry.pinned ? "unpin" : "pin"),
        ),
      );
      if (entry.state === "active") {
        actions.push(
          changeButton("标为失效", "memory-invalidate", () =>
            change("invalidate", reasonInput.value),
          ),
        );
      }
      if (entry.state === "invalidated") {
        actions.push(
          changeButton("恢复", "memory-restore", () => change("restore")),
        );
      }
      actions.push(
        button("删除…", openDelete, {
          attrs: { id: "memory-delete-open" },
          className: "danger",
        }),
      );
    }
    for (const node of actions) node.toggleAttribute("disabled", busy);
    detailBox.replaceChildren(
      ...present(
        el("h3", {
          attrs: { id: "memory-detail-title" },
          text: `${entry.name}（修订 ${String(entry.revision)}，${memoryStateLabel(entry.state)}${entry.pinned ? "，置顶" : ""}）`,
        }),
        detailStale,
        field("类型", entry.type),
        field(
          "描述",
          entry.state === "deleted"
            ? "（描述已随删除清空）"
            : entry.description,
        ),
        field(
          "作者",
          provenanceLabel(entry.provenance, instanceLabel),
          "memory-detail-author",
        ),
        field("记录时间", localTime(entry.provenance.recordedAt)),
        el("div", { className: "field" }, [
          el("span", { className: "field-label", text: "正文" }),
          el("pre", {
            attrs: { id: "memory-detail-body" },
            className: "memory-body",
            text:
              entry.body ?? "（正文已删除：平台在线读取与检索不再返回正文）",
          }),
        ]),
        entry.state === "active" ? labelled("失效原因", reasonInput) : null,
        el("div", { className: "form-actions" }, actions),
        deleteArea,
        actionStatus,
        intentControls(entrySlot, "memory-entry", actionStatus),
        el("h4", { text: "修订历史" }),
        history === undefined
          ? el("p", { className: "muted", text: "读取中…" })
          : el(
              "ol",
              { attrs: { id: "memory-history" }, className: "memory-history" },
              [
                ...history.revisions.map((revision) =>
                  el(
                    "li",
                    {
                      attrs: {
                        "data-op": revision.op,
                        "data-revision": String(revision.revision),
                      },
                      className: "memory-revision",
                    },
                    [
                      el("strong", {
                        text: `修订 ${String(revision.revision)} · ${memoryOpLabel(revision.op)} · ${memoryStateLabel(revision.state)}${revision.pinned ? " · 置顶" : ""}`,
                      }),
                      el("div", {
                        className: "muted",
                        text: `${localTime(revision.provenance.recordedAt)} · ${provenanceLabel(revision.provenance, instanceLabel)}`,
                      }),
                      revision.reason === null
                        ? null
                        : field(
                            "原因",
                            revision.reason,
                            "memory-revision-reason",
                          ),
                      el("pre", {
                        className: "memory-body",
                        text: revision.body ?? "（正文已删除）",
                      }),
                    ],
                  ),
                ),
                history.truncated
                  ? el("li", { className: "muted", text: "更早的修订已截断" })
                  : null,
              ],
            ),
      ),
    );
    renderDetailStale();
  };

  // Review P2-3: one load owner decides what the detail shows; a late
  // response for another selection, or after the panel stopped, never lands.
  const detailLoader = createMemoryDetailLoader(
    {
      read: (entryId, signal) =>
        context.client.request("memory.read", { entryId }, { signal }),
      history: (entryId, signal) =>
        context.client.request("memory.history", { entryId }, { signal }),
    },
    (state) => {
      current = state.current;
      history = state.history;
      if (state.current !== undefined)
        details.set(detailKey(state.current), state.current);
      if (state.error !== undefined && !isAbort(state.error)) {
        detailBox.hidden = false;
        detailBox.replaceChildren(
          el("p", {
            className: "error",
            text: `记忆读取失败：${errorText(state.error)}`,
          }),
        );
        return;
      }
      renderDetail();
    },
  );

  const select = async (entryId: string) => {
    selectedId = entryId;
    deleteArea.replaceChildren();
    actionStatus.textContent = "";
    actionStatus.className = "action-status";
    renderList();
    await detailLoader.select(entryId);
  };

  const refreshAfterWrite = async () => {
    await detailLoader.reload();
    await loadList();
  };

  const settle = (
    outcome: IntentOutcome<{ deduplicated: boolean; entry: MemoryEntryDetail }>,
    label: string,
    submittedRevision: number,
  ) => {
    if (outcome.kind === "rejected" && isRevisionConflict(outcome.error)) {
      void refreshAfterWrite().then(() => {
        setStatus(
          actionStatus,
          "error",
          `修订冲突：${errorText(outcome.error)}。提交基于修订 ${String(submittedRevision)}，已重新读取${current === undefined ? "" : `为修订 ${String(current.revision)}`}，请确认后再操作`,
        );
      });
      return;
    }
    reportOutcome(actionStatus, outcome, `${label}被拒绝`, (result) => {
      void refreshAfterWrite().then(() => {
        setStatus(
          actionStatus,
          "ok",
          `已${label}：修订 ${String(result.entry.revision)}${result.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
        );
      });
    });
  };

  const LABELS: Record<MemoryChangeKind, string> = {
    delete: "删除",
    invalidate: "标为失效",
    pin: "置顶",
    restore: "恢复",
    unpin: "取消置顶",
  };

  function change(kind: MemoryChangeKind, reason?: string): void {
    if (entrySlot.state === "unknown") {
      setStatus(actionStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (
      entrySlot.state === "pending" ||
      current === undefined ||
      !detailLoader.state().actionable ||
      current.entryId !== selectedId
    )
      return;
    const built = buildMemoryChange(kind, current, reason);
    if (!built.ok) {
      setStatus(actionStatus, "error", built.error);
      return;
    }
    const submitted = built.value.payload.expectedRevision;
    setStatus(actionStatus, "info", `${LABELS[kind]}中…`);
    void entrySlot
      .submitRevisioned({
        action: `memory-${kind}`,
        payload: built.value,
        send: (payload, idempotencyKey) =>
          sendMemoryChange(context.client, payload, idempotencyKey),
        onSettled: (outcome) => {
          if (outcome.kind === "ok" && kind === "invalidate") {
            reasonInput.value = "";
          }
          if (outcome.kind === "ok" && kind === "delete") {
            deleteArea.replaceChildren();
          }
          settle(outcome, LABELS[kind], submitted);
        },
      })
      .catch(() => undefined);
  }

  function openDelete(): void {
    if (current === undefined) return;
    const reason = el("textarea", {
      attrs: {
        id: "memory-delete-reason",
        placeholder: "删除原因（必填）",
        rows: "2",
      },
    });
    deleteArea.replaceChildren(
      el(
        "div",
        {
          attrs: { id: "memory-delete-confirm", role: "alertdialog" },
          className: "confirm-box",
        },
        [
          el("p", {
            attrs: { id: "memory-delete-text" },
            text: deleteConfirmText(current),
          }),
          labelled("删除原因", reason),
          el("div", { className: "form-actions" }, [
            button("确认删除", () => change("delete", reason.value), {
              attrs: { id: "memory-delete-submit" },
              className: "danger",
            }),
            button("取消", () => deleteArea.replaceChildren(), {
              attrs: { id: "memory-delete-cancel" },
              className: "secondary",
            }),
          ]),
        ],
      ),
    );
    reason.focus();
  }

  entrySlot.onChange((state) => {
    const busy = state !== "idle";
    for (const node of detailBox.querySelectorAll<HTMLButtonElement>(
      "#memory-pin, #memory-invalidate, #memory-restore, #memory-delete-open, #memory-delete-submit",
    )) {
      node.disabled = busy;
    }
  });

  // -------------------------------------------------------------- switches
  const policySlot = new WriteIntentSlot();
  const policyBase = el("p", {
    attrs: { id: "memory-policy-base" },
    className: "muted",
  });
  const policyStale = statusLine("memory-policy-stale");
  const policyFields = el("div", { attrs: { id: "memory-policy-fields" } });
  const policyStatus = statusLine("memory-policy-status");
  const policySubmit = button("保存开关", () => submitPolicy(), {
    attrs: { id: "memory-policy-submit" },
  });
  let policy: MemoryPolicy | undefined;
  let latestPolicy: MemoryPolicy | undefined;
  let readDefault: HTMLSelectElement | undefined;
  let writeDefault: HTMLSelectElement | undefined;
  const overrideSelects = new Map<
    string,
    { read: HTMLSelectElement; write: HTMLSelectElement }
  >();

  const renderPolicyStale = () => {
    if (
      policy !== undefined &&
      latestPolicy !== undefined &&
      latestPolicy.revision !== policy.revision
    ) {
      setStatus(
        policyStale,
        "info",
        `开关已在别处更新为修订 ${String(latestPolicy.revision)}；以修订 ${String(policy.revision)} 提交会被拒绝，请先重新读取`,
      );
    } else {
      policyStale.textContent = "";
      policyStale.className = "action-status";
    }
  };

  const fillPolicy = (next: MemoryPolicy) => {
    policy = next;
    latestPolicy = next;
    const form = policyFormFrom(next);
    readDefault = booleanSelect("memory-read-default", form.readDefault);
    writeDefault = booleanSelect("memory-write-default", form.writeDefault);
    overrideSelects.clear();
    const rows = Object.entries(form.overrides).map(([instanceId, choice]) => {
      const read = choiceSelect(
        "memory-override-read",
        choice.read,
        `${instanceLabel(instanceId)} 读`,
      );
      const write = choiceSelect(
        "memory-override-write",
        choice.write,
        `${instanceLabel(instanceId)} 写`,
      );
      overrideSelects.set(instanceId, { read, write });
      const effective = next.members.find(
        (member) => member.instanceId === instanceId,
      );
      return el(
        "tr",
        {
          attrs: { "data-instance-id": instanceId },
          className: "memory-policy-row",
        },
        [
          el("td", { text: instanceLabel(instanceId) }),
          el("td", {}, [read]),
          el("td", {}, [write]),
          el("td", {
            className: "memory-effective",
            text:
              effective === undefined
                ? "已不是成员"
                : `读 ${accessLabel(effective.read)} · 写 ${accessLabel(effective.write)}`,
          }),
        ],
      );
    });
    policyFields.replaceChildren(
      labelled("频道默认：读", readDefault),
      labelled("频道默认：写", writeDefault),
      el("div", { className: "table-scroll" }, [
        el("table", { className: "usage-table memory-policy-table" }, [
          el("thead", {}, [
            el("tr", {}, [
              el("th", { text: "实例" }),
              el("th", { text: "读（覆盖）" }),
              el("th", { text: "写（覆盖）" }),
              el("th", { text: "实际生效" }),
            ]),
          ]),
          el(
            "tbody",
            {},
            rows.length === 0
              ? [el("tr", {}, [el("td", { text: "没有实例成员" })])]
              : rows,
          ),
        ]),
      ]),
    );
    policyBase.textContent = `开关修订 ${String(next.revision)}（表单基于此修订）`;
    renderPolicyStale();
  };

  const readPolicy = async (signal?: AbortSignal) =>
    await context.client.request(
      "memory.policy.read",
      { channelId },
      signal === undefined ? undefined : { signal },
    );

  const reloadPolicy = async (): Promise<MemoryPolicy | undefined> => {
    try {
      const next = await readPolicy();
      fillPolicy(next);
      return next;
    } catch (error) {
      setStatus(policyStatus, "error", `记忆开关读取失败：${errorText(error)}`);
      return undefined;
    }
  };

  const policyForm = (): PolicyForm | undefined =>
    readDefault === undefined || writeDefault === undefined
      ? undefined
      : {
          overrides: Object.fromEntries(
            [...overrideSelects].map(([instanceId, selects]) => [
              instanceId,
              {
                read: selects.read.value as AccessChoice,
                write: selects.write.value as AccessChoice,
              },
            ]),
          ),
          readDefault: readDefault.value === "on",
          writeDefault: writeDefault.value === "on",
        };

  const policyEdited = (): boolean => {
    const form = policyForm();
    return (
      policy !== undefined &&
      form !== undefined &&
      buildPolicyUpdate(policy, form).ok
    );
  };

  function submitPolicy(): void {
    if (policySlot.state === "unknown") {
      setStatus(policyStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (policySlot.state === "pending") return;
    const form = policyForm();
    if (policy === undefined || form === undefined) {
      setStatus(policyStatus, "error", "记忆开关尚未读取");
      return;
    }
    const update = buildPolicyUpdate(policy, form);
    if (!update.ok) {
      setStatus(policyStatus, "error", update.error);
      return;
    }
    const submitted = update.value.expectedRevision;
    setStatus(policyStatus, "info", "保存中…");
    void policySlot
      .submitRevisioned({
        action: "memory-policy",
        payload: update.value,
        send: (payload, idempotencyKey) =>
          context.client.request("memory.policy.update", {
            ...payload,
            idempotencyKey,
          }),
        onSettled: (outcome) => {
          if (
            outcome.kind === "rejected" &&
            isRevisionConflict(outcome.error)
          ) {
            void reloadPolicy().then((next) => {
              setStatus(
                policyStatus,
                "error",
                `修订冲突：${errorText(outcome.error)}。表单基于修订 ${String(submitted)}，已重新读取${next === undefined ? "（读取失败）" : `修订 ${String(next.revision)}`}，请确认后再提交`,
              );
            });
            return;
          }
          reportOutcome(policyStatus, outcome, "保存被拒绝", (result) => {
            fillPolicy(result.policy);
            setStatus(
              policyStatus,
              "ok",
              `已保存为开关修订 ${String(result.policy.revision)}${result.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
            );
          });
        },
      })
      .catch(() => undefined);
  }
  policySlot.onChange((state) => {
    policySubmit.disabled = state !== "idle";
  });

  // ---------------------------------------------------------------- import
  const importSlot = new WriteIntentSlot();
  const importStatus = statusLine("memory-import-status");
  const importResults = el("ul", {
    attrs: { id: "memory-import-results" },
    className: "memory-import-results",
  });
  const importList = el("ul", {
    attrs: { id: "memory-import-list" },
    className: "memory-import-list",
  });
  const importPaths = new Map<string, HTMLTextAreaElement>();

  const runImport = (instanceId: string, mode: "whole" | "files") => {
    if (importSlot.state === "unknown") {
      setStatus(importStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (importSlot.state === "pending") return;
    const built = buildImportRequest(
      channelId,
      instanceId,
      mode,
      mode === "files" ? (importPaths.get(instanceId)?.value ?? "") : "",
    );
    if (!built.ok) {
      setStatus(importStatus, "error", built.error);
      return;
    }
    setStatus(
      importStatus,
      "info",
      `导入 ${instanceLabel(instanceId)} 的旧记忆中…`,
    );
    void importSlot
      .submitRevisioned({
        action: "memory-import",
        payload: built.value,
        send: (payload, idempotencyKey) =>
          context.client.request("memory.import.legacy", {
            ...payload,
            idempotencyKey,
          }),
        onSettled: (outcome) =>
          reportOutcome(importStatus, outcome, "导入被拒绝", (result) => {
            importResults.replaceChildren(
              ...(result.results.length === 0
                ? [el("li", { className: "muted", text: "没有可导入的文件" })]
                : result.results.map((item) =>
                    el("li", {
                      attrs: {
                        "data-path": item.path,
                        "data-status": item.status,
                      },
                      className: `memory-import-result status-${item.status}`,
                      text: importResultLabel(item),
                    }),
                  )),
            );
            const created = result.results.filter(
              (item) => item.status === "created",
            ).length;
            setStatus(
              importStatus,
              "ok",
              `导入完成（${instanceLabel(result.instanceId)}）：新建 ${String(created)}，共 ${String(result.results.length)} 个文件结果`,
            );
            void loadList();
          }),
      })
      .catch(() => undefined);
  };

  const renderImport = () => {
    const members = instances.filter(({ member }) => member);
    importList.replaceChildren(
      ...(members.length === 0
        ? [el("li", { className: "muted", text: "本频道没有实例成员" })]
        : members.map(({ instanceId, label }) => {
            let paths = importPaths.get(instanceId);
            if (paths === undefined) {
              paths = el("textarea", {
                attrs: {
                  placeholder:
                    "逐文件导入时可选：每行一个相对路径（如 notes/a.md）；留空导入全部文件",
                  rows: "2",
                },
                className: "memory-import-paths",
              });
              importPaths.set(instanceId, paths);
            }
            return el(
              "li",
              {
                attrs: { "data-instance-id": instanceId },
                className: "memory-import-row",
              },
              [
                el("strong", { text: label }),
                el("div", { className: "form-actions" }, [
                  button(
                    "导入旧记忆（整体为一条）",
                    () => runImport(instanceId, "whole"),
                    { className: "secondary memory-import-whole" },
                  ),
                  button(
                    "导入旧记忆（逐文件）",
                    () => runImport(instanceId, "files"),
                    { className: "secondary memory-import-files" },
                  ),
                ]),
                paths,
              ],
            );
          })),
    );
    for (const node of importList.querySelectorAll("button")) {
      node.disabled = importSlot.state !== "idle";
    }
  };
  importSlot.onChange(renderImport);

  // ------------------------------------------------------------- assemble
  const searchSubmit = button(
    "检索",
    () => {
      searchQuery = searchInput.value.trim();
      void loadList();
    },
    { attrs: { id: "memory-search-submit" }, className: "secondary" },
  );
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      searchSubmit.click();
    }
  });
  const clearSearch = button(
    "清除检索",
    () => {
      searchInput.value = "";
      searchQuery = "";
      void loadList();
    },
    { attrs: { id: "memory-search-clear" }, className: "secondary" },
  );
  for (const toggle of [includeInvalidated, includeDeleted]) {
    toggle.addEventListener("change", () => void loadList());
  }

  const element = el(
    "section",
    { attrs: { id: "memory-panel" }, className: "panel memory-panel" },
    [
      el("h2", { text: "频道记忆" }),
      el("p", {
        className: "muted",
        text: "本频道的平台长期记忆；作者来源只证明是谁写的，不证明内容正确。",
      }),
      el("div", { className: "form-actions memory-toolbar" }, [
        el("label", {}, [includeInvalidated, " 含已失效"]),
        el("label", {}, [includeDeleted, " 含已删除"]),
        searchInput,
        searchSubmit,
        clearSearch,
        button("重新读取", () => void loadList(), {
          attrs: { id: "memory-reload" },
          className: "secondary",
        }),
      ]),
      listStatus,
      list,
      detailBox,
      el("h3", { text: "记忆开关（读 / 写）" }),
      policyBase,
      policyStale,
      policyFields,
      el("div", { className: "form-actions" }, [
        policySubmit,
        button(
          "重新读取开关",
          () => {
            void reloadPolicy().then((next) => {
              if (next !== undefined) {
                setStatus(
                  policyStatus,
                  "info",
                  `已重新读取开关修订 ${String(next.revision)}`,
                );
              }
            });
          },
          { attrs: { id: "memory-policy-reload" }, className: "secondary" },
        ),
      ]),
      policyStatus,
      intentControls(policySlot, "memory-policy", policyStatus),
      el("h3", { text: "导入旧记忆（一次性 Human 操作）" }),
      el("p", {
        attrs: { id: "memory-import-note" },
        className: "muted",
        text: MEMORY_IMPORT_NOTE,
      }),
      importList,
      importStatus,
      intentControls(importSlot, "memory-import", importStatus),
      importResults,
    ],
  );

  const poller = new Poller(MEMORY_POLL_MS, async (signal) => {
    await loadList(signal);
    try {
      const next = await readPolicy(signal);
      if (signal.aborted) return;
      latestPolicy = next;
      // The form keeps its base revision; a newer one is shown, not merged.
      if (policy === undefined) fillPolicy(next);
      else renderPolicyStale();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      setStatus(policyStatus, "error", `记忆开关读取失败：${errorText(error)}`);
    }
  });
  poller.start();

  return {
    element,
    setInstances: (next) => {
      const changed =
        next.length !== instances.length ||
        next.some(
          (item, index) =>
            item.instanceId !== instances[index]?.instanceId ||
            item.label !== instances[index]?.label ||
            item.member !== instances[index]?.member,
        );
      instances = next;
      if (!changed) return;
      renderImport();
      renderList();
      if (policy !== undefined && !policyEdited()) {
        // Membership or labels changed and nothing is being edited: re-read
        // so the rows cover every member with current labels.
        void readPolicy()
          .then((fresh) => {
            latestPolicy = fresh;
            if (!policyEdited()) fillPolicy(fresh);
            else renderPolicyStale();
          })
          .catch(() => undefined);
      }
    },
    stop: () => {
      poller.stop();
      detailLoader.stop();
    },
  };
}
