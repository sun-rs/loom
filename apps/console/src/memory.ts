/**
 * Channel memory panel logic (no DOM): change and switch payloads, labels
 * and the deletion boundary. The Kernel owns every decision; these only
 * build requests from what the Human sees (the entry's current revision is
 * the `expectedRevision`) and pre-check them with the protocol schemas.
 * Throwaway: deleted in phase 4.
 */
import { RahClientError, type RahClient } from "@rah-os/client-sdk";
import {
  ClientMemoryImportLegacyRequestSchema,
  ClientMemoryPolicyUpdateRequestSchema,
  MemoryReasonSchema,
  type ClientMemoryImportLegacyRequest,
  type ClientMemoryPolicyUpdateRequest,
  type MemoryEntry,
  type MemoryEntryState,
  type MemoryImportLegacyResponse,
  type MemoryMutationResponse,
  type MemoryPolicy,
  type MemoryProvenance,
  type MemoryRevisionOperation,
} from "@rah-os/protocol";

import type { Checked } from "./actions.ts";

/** Target contract §4 deletion boundary, shown before every delete. */
export const MEMORY_DELETE_BOUNDARY =
  "删除后平台在线读取与检索不再能取得正文与描述（当前与所有修订都清空）；不追溯清理已进入 session、诊断、备份或 SQLite 物理残留（WAL）的副本。";

export const MEMORY_IMPORT_NOTE =
  "一次性 Human 导入：把该实例旧的私有记忆（MEMORY.md 与 notes/ 下的文件）复制为本频道的平台记忆。只读取旧目录，不修改它；不会自动执行。已导入过的文件显示为“已导入过”，不会重复创建。";

export type MemoryChangeKind =
  "invalidate" | "restore" | "delete" | "pin" | "unpin";

type Base = { entryId: string; expectedRevision: number };

export type MemoryChange =
  | { op: "memory.invalidate"; payload: Base & { reason: string } }
  | { op: "memory.delete"; payload: Base & { reason: string } }
  | { op: "memory.restore"; payload: Base }
  | { op: "memory.pin"; payload: Base & { pinned: boolean } };

type EntryView = Pick<MemoryEntry, "entryId" | "pinned" | "revision" | "state">;

function reasonOf(value: string | undefined): Checked<string> {
  const parsed = MemoryReasonSchema.safeParse(value ?? "");
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "请填写原因（1–500 字）" };
}

/** A change to the entry as shown, based on its current revision. */
export function buildMemoryChange(
  kind: MemoryChangeKind,
  entry: EntryView,
  reason?: string,
): Checked<MemoryChange> {
  const base = { entryId: entry.entryId, expectedRevision: entry.revision };
  if (entry.state === "deleted") {
    return { ok: false, error: "该记忆已删除，不能再修改" };
  }
  switch (kind) {
    case "invalidate":
    case "delete": {
      if (kind === "invalidate" && entry.state !== "active") {
        return { ok: false, error: "只有有效的记忆可以标为失效" };
      }
      const checked = reasonOf(reason);
      if (!checked.ok) return checked;
      return {
        ok: true,
        value: {
          op: kind === "invalidate" ? "memory.invalidate" : "memory.delete",
          payload: { ...base, reason: checked.value },
        },
      };
    }
    case "restore":
      return entry.state === "invalidated"
        ? { ok: true, value: { op: "memory.restore", payload: base } }
        : { ok: false, error: "只有已失效的记忆可以恢复" };
    case "pin":
    case "unpin": {
      const pinned = kind === "pin";
      if (entry.pinned === pinned) {
        return { ok: false, error: pinned ? "已经置顶" : "没有置顶" };
      }
      return {
        ok: true,
        value: { op: "memory.pin", payload: { ...base, pinned } },
      };
    }
  }
}

export async function sendMemoryChange(
  client: RahClient,
  change: Readonly<MemoryChange>,
  idempotencyKey: string,
): Promise<MemoryMutationResponse> {
  switch (change.op) {
    case "memory.invalidate":
      return await client.request(change.op, {
        ...change.payload,
        idempotencyKey,
      });
    case "memory.delete":
      return await client.request(change.op, {
        ...change.payload,
        idempotencyKey,
      });
    case "memory.restore":
      return await client.request(change.op, {
        ...change.payload,
        idempotencyKey,
      });
    case "memory.pin":
      return await client.request(change.op, {
        ...change.payload,
        idempotencyKey,
      });
  }
}

export function deleteConfirmText(
  entry: Pick<MemoryEntry, "name" | "revision">,
): string {
  return `删除记忆 ${entry.name}（修订 ${String(entry.revision)}）。${MEMORY_DELETE_BOUNDARY}删除需要填写原因，名称、删除时间与原因作为墓碑保留。`;
}

/** A revision (or policy revision) mismatch: re-read before changing. */
export function isRevisionConflict(error: unknown): boolean {
  return (
    error instanceof RahClientError &&
    error.status === 409 &&
    error.code !== "stale_context"
  );
}

const STATE_LABELS: Record<MemoryEntryState, string> = {
  active: "有效",
  deleted: "已删除",
  invalidated: "已失效",
};

export function memoryStateLabel(state: MemoryEntryState): string {
  return STATE_LABELS[state];
}

const OP_LABELS: Record<MemoryRevisionOperation, string> = {
  create: "创建",
  delete: "删除",
  invalidate: "标为失效",
  pin: "置顶",
  restore: "恢复",
  unpin: "取消置顶",
  update: "更新",
};

export function memoryOpLabel(op: MemoryRevisionOperation): string {
  return OP_LABELS[op];
}

const unknown = (value: string | number | null): string =>
  value === null ? "未知" : String(value);

/** Author provenance: who wrote it, never whether it is correct. */
export function provenanceLabel(
  provenance: MemoryProvenance,
  instanceLabel: (instanceId: string) => string,
): string {
  const parts: string[] = [];
  if (provenance.actorKind === "human") {
    parts.push(`Human（${provenance.actorPrincipalId}）`);
  } else {
    parts.push(
      `实例 ${instanceLabel(provenance.instanceId ?? provenance.actorPrincipalId)}`,
      `模型 ${
        provenance.modelBindingId === null
          ? "未知"
          : `${provenance.modelBindingId}/${unknown(provenance.modelReasoning)}`
      }`,
      `session 代数 ${unknown(provenance.sessionGeneration)}`,
      `RunAttempt ${unknown(provenance.runAttemptId)}`,
    );
  }
  if (provenance.importedFrom !== undefined) {
    parts.push(
      `导入自实例 ${instanceLabel(provenance.importedFrom.instanceId)} 的 ${provenance.importedFrom.path}`,
    );
  }
  return parts.join(" · ");
}

export type AccessChoice = "inherit" | "on" | "off";

export type PolicyForm = {
  overrides: Record<string, { read: AccessChoice; write: AccessChoice }>;
  readDefault: boolean;
  writeDefault: boolean;
};

const choiceOf = (value: boolean | null | undefined): AccessChoice =>
  value === true ? "on" : value === false ? "off" : "inherit";

const valueOf = (choice: AccessChoice): boolean | null =>
  choice === "on" ? true : choice === "off" ? false : null;

/** Rows for every current member and every recorded override. */
export function policyFormFrom(policy: MemoryPolicy): PolicyForm {
  const overrides: PolicyForm["overrides"] = {};
  const ids = [
    ...policy.members.map(({ instanceId }) => instanceId),
    ...policy.overrides.map(({ instanceId }) => instanceId),
  ];
  for (const instanceId of ids) {
    const recorded = policy.overrides.find(
      (override) => override.instanceId === instanceId,
    );
    overrides[instanceId] = {
      read: choiceOf(recorded?.read),
      write: choiceOf(recorded?.write),
    };
  }
  return {
    overrides,
    readDefault: policy.readDefault,
    writeDefault: policy.writeDefault,
  };
}

export type PolicyUpdate = Omit<
  ClientMemoryPolicyUpdateRequest,
  "idempotencyKey"
>;

/**
 * Only what differs from the policy revision the form was built from, with
 * that revision as `expectedRevision`. An override set back to inherit on
 * both switches is sent as nulls, which removes it.
 */
export function buildPolicyUpdate(
  policy: MemoryPolicy,
  form: PolicyForm,
): Checked<PolicyUpdate> {
  const base = policyFormFrom(policy);
  const update: PolicyUpdate = {
    channelId: policy.channelId,
    expectedRevision: policy.revision,
  };
  if (form.readDefault !== policy.readDefault) {
    update.readDefault = form.readDefault;
  }
  if (form.writeDefault !== policy.writeDefault) {
    update.writeDefault = form.writeDefault;
  }
  const overrides = Object.entries(form.overrides).flatMap(
    ([instanceId, choice]) => {
      const before = base.overrides[instanceId] ?? {
        read: "inherit",
        write: "inherit",
      };
      return before.read === choice.read && before.write === choice.write
        ? []
        : [
            {
              instanceId,
              read: valueOf(choice.read),
              write: valueOf(choice.write),
            },
          ];
    },
  );
  if (overrides.length > 0) update.overrides = overrides;
  if (
    update.readDefault === undefined &&
    update.writeDefault === undefined &&
    update.overrides === undefined
  ) {
    return { ok: false, error: "没有修改" };
  }
  const parsed = ClientMemoryPolicyUpdateRequestSchema.safeParse({
    ...update,
    idempotencyKey: "console-precheck",
  });
  return parsed.success
    ? { ok: true, value: update }
    : {
        ok: false,
        error: `开关设置无效：${parsed.error.issues.map(({ message }) => message).join("；")}`,
      };
}

export function accessLabel(value: boolean): string {
  return value ? "开" : "关";
}

export type ImportRequest = Omit<
  ClientMemoryImportLegacyRequest,
  "idempotencyKey"
>;

/** `pathsText`: one relative path per line; files mode only, optional. */
export function buildImportRequest(
  channelId: string,
  instanceId: string,
  mode: "whole" | "files",
  pathsText: string,
): Checked<ImportRequest> {
  const relativePaths = pathsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (mode === "whole" && relativePaths.length > 0) {
    return { ok: false, error: "整体导入不选择文件；逐文件导入才能指定路径" };
  }
  const request: ImportRequest = {
    channelId,
    instanceId,
    mode,
    ...(relativePaths.length === 0 ? {} : { relativePaths }),
  };
  const parsed = ClientMemoryImportLegacyRequestSchema.safeParse({
    ...request,
    idempotencyKey: "console-precheck",
  });
  return parsed.success
    ? { ok: true, value: request }
    : {
        ok: false,
        error: `导入请求无效：${parsed.error.issues.map(({ message }) => message).join("；")}`,
      };
}

export function importResultLabel(
  result: MemoryImportLegacyResponse["results"][number],
): string {
  switch (result.status) {
    case "created":
      return `${result.path}：已创建 ${result.name ?? result.entryId ?? ""}`;
    case "existing":
      return `${result.path}：已导入过（${result.name ?? result.entryId ?? ""}）${result.reason === undefined ? "" : `，${result.reason}`}`;
    case "skipped":
      return `${result.path}：跳过（${result.reason ?? "未说明原因"}）`;
  }
}
