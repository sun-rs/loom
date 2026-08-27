import { useMemo, useState } from "react";

import type {
  ClientAgentProvisionRequest,
  LocalRuntimeInventoryEntry,
} from "@rah-os/protocol";

import { useDialogProtocol } from "../dialog-protocol.ts";

export type AgentCreateInput = Omit<
  ClientAgentProvisionRequest,
  "basedOnRoomSeq" | "controlRoomId" | "idempotencyKey"
>;

const RAFT_AVATAR_KEYS = [
  "alien",
  "bell",
  "cat",
  "cloud",
  "crown",
  "diamond",
  "eye",
  "finch",
  "flame",
  "ghost",
  "heart",
  "mug",
  "mushroom",
  "robot",
  "skull",
  "star",
  "sun",
  "tree",
] as const;

export function AgentCreateDialog({
  onClose,
  onCreate,
  runtimes,
  workspaceName,
}: {
  onClose: () => void;
  onCreate: (input: AgentCreateInput) => Promise<void>;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  workspaceName: string;
}) {
  const runtimeOptions = useMemo(
    () =>
      runtimes.filter(
        (runtime) =>
          runtime.available &&
          runtime.configured &&
          runtime.runtimeOfferId !== undefined,
      ),
    [runtimes],
  );
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [avatarKey, setAvatarKey] = useState<string>("robot");
  const [runtimeOfferId, setRuntimeOfferId] = useState(
    runtimeOptions[0]?.runtimeOfferId ?? "",
  );
  const [reasoning, setReasoning] = useState<
    "default" | "low" | "medium" | "high" | "max"
  >("default");
  const [sessionPolicy, setSessionPolicy] = useState<
    "fresh" | "prefer_resume" | "require_resume"
  >("fresh");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const valid =
    displayName.trim() !== "" &&
    /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(handle.trim()) &&
    role.trim() !== "" &&
    instructions.trim() !== "" &&
    runtimeOfferId !== "";

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭创建 Agent 窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-agent-create-title"
        aria-modal="true"
        className="rah-dialog rah-agent-create-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-agent-create-title">创建 Agent</h2>
            <p>{workspaceName} · 长期身份与真实 Runtime</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setPending(true);
            void onCreate({
              avatarKey,
              ...(description.trim() === ""
                ? {}
                : { description: description.trim() }),
              displayName: displayName.trim(),
              handle: handle.trim(),
              instructions: instructions.trim(),
              modelIntent: { fallback: "disabled", reasoning },
              role: role.trim(),
              runtimeOfferId,
              sessionPolicy,
            })
              .then(() => setActionError(undefined))
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <div className="rah-agent-form-grid">
            <label>
              显示名称
              <input
                autoFocus
                maxLength={128}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setDisplayName(nextName);
                  if (!handleEdited) setHandle(handleFromName(nextName));
                }}
                placeholder="Alice"
                value={displayName}
              />
            </label>
            <label>
              Handle
              <input
                maxLength={64}
                onChange={(event) => {
                  setHandleEdited(true);
                  setHandle(handleFromName(event.target.value));
                }}
                placeholder="alice"
                value={handle}
              />
            </label>
            <label>
              头像
              <select
                onChange={(event) => setAvatarKey(event.target.value)}
                value={avatarKey}
              >
                {RAFT_AVATAR_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Runtime
              <select
                onChange={(event) => setRuntimeOfferId(event.target.value)}
                value={runtimeOfferId}
              >
                {runtimeOptions.length === 0 ? (
                  <option value="">没有可运行的 Runtime</option>
                ) : null}
                {runtimeOptions.map((runtime) => (
                  <option
                    key={runtime.runtimeOfferId}
                    value={runtime.runtimeOfferId}
                  >
                    {runtime.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            角色
            <input
              maxLength={512}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Engineering Agent"
              value={role}
            />
          </label>
          <label>
            描述（可选）
            <textarea
              maxLength={2_000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="该 Agent 在 Workspace 中承担什么职责"
              rows={2}
              value={description}
            />
          </label>
          <label>
            Agent 指令
            <textarea
              maxLength={64 * 1_024}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="定义行为边界、工作方法与交付标准"
              rows={6}
              value={instructions}
            />
          </label>
          <div className="rah-agent-form-grid">
            <label>
              推理强度
              <select
                onChange={(event) =>
                  setReasoning(event.target.value as typeof reasoning)
                }
                value={reasoning}
              >
                <option value="default">Runtime 默认</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
            </label>
            <label>
              Session 策略
              <select
                onChange={(event) =>
                  setSessionPolicy(event.target.value as typeof sessionPolicy)
                }
                value={sessionPolicy}
              >
                <option value="fresh">每次新建</option>
                <option value="prefer_resume">优先续接</option>
                <option value="require_resume">必须续接</option>
              </select>
            </label>
          </div>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "正在创建…" : "创建 Agent"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function handleFromName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+|[-._]+$/gu, "")
    .slice(0, 64);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
