import { useEffect, useMemo, useState } from "react";

import type {
  ClientAgentGetResponse,
  ClientAgentManageRequest,
  ClientAgentProvisionRequest,
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
} from "@rah-os/protocol";

import {
  normalizeModelBindingId,
  normalizeReasoningLevel,
  runtimeModelOptions,
  supportedReasoningLevels,
} from "../agent-runtime-capabilities.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";

export type AgentCreateInput = Omit<
  ClientAgentProvisionRequest,
  "basedOnRoomSeq" | "controlRoomId" | "idempotencyKey"
>;
export type AgentConfigureInput = Omit<
  Extract<ClientAgentManageRequest, { action: "configure" }>,
  "action" | "agentDefinitionId" | "basedOnRoomSeq" | "idempotencyKey"
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
  const [modelBindingId, setModelBindingId] = useState("runtime_default");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("default");
  const [sessionPolicy, setSessionPolicy] = useState<
    "fresh" | "prefer_resume" | "require_resume"
  >("fresh");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const modelOptions = runtimeModelOptions(selectedRuntime);
  const reasoningOptions = supportedReasoningLevels(
    selectedRuntime,
    modelBindingId,
  );
  useEffect(() => {
    const normalizedBinding = normalizeModelBindingId(
      modelBindingId,
      selectedRuntime,
    );
    if (normalizedBinding !== modelBindingId) {
      setModelBindingId(normalizedBinding);
    }
    setReasoning((current) =>
      normalizeReasoningLevel(current, selectedRuntime, normalizedBinding),
    );
  }, [modelBindingId, selectedRuntime]);
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
              modelIntent: modelIntent(modelBindingId, reasoning),
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
            <label>
              模型
              <select
                onChange={(event) => {
                  const next = event.target.value;
                  setModelBindingId(next);
                  setReasoning((current) =>
                    normalizeReasoningLevel(current, selectedRuntime, next),
                  );
                }}
                value={modelBindingId}
              >
                {modelOptions.map((option) => (
                  <option
                    key={option.modelBindingId}
                    value={option.modelBindingId}
                  >
                    {option.label}
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
                {reasoningOptions.map((level) => (
                  <option key={level} value={level}>
                    {reasoningLabel(level)}
                  </option>
                ))}
              </select>
              {reasoningOptions.length === 1 ? (
                <small>当前模型未发布可执行的推理档位，将使用默认值。</small>
              ) : null}
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

export function AgentManageDialog({
  detail,
  onClose,
  onConfigure,
  onState,
  runtimes,
}: {
  detail: ClientAgentGetResponse;
  onClose: () => void;
  onConfigure: (input: AgentConfigureInput) => Promise<void>;
  onState: (state: "disabled" | "enabled" | "tombstoned") => Promise<void>;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const revision = detail.agent.currentRevision;
  const policy = detail.policy;
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
  const [displayName, setDisplayName] = useState(
    revision.displayName ?? detail.agent.handle,
  );
  const [handle, setHandle] = useState(detail.agent.handle);
  const [description, setDescription] = useState(revision.description ?? "");
  const [role, setRole] = useState(revision.role);
  const [instructions, setInstructions] = useState(revision.instructions ?? "");
  const [avatarKey, setAvatarKey] = useState(revision.avatarKey ?? "robot");
  const [runtimeOfferId, setRuntimeOfferId] = useState(
    policy.required.allowedOfferIds?.[0] ??
      runtimeOptions[0]?.runtimeOfferId ??
      "",
  );
  const initialRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const configuredModelBindingId = policy.modelIntent.exactBindingIds?.[0];
  const initialModelBindingId = normalizeModelBindingId(
    configuredModelBindingId,
    initialRuntime,
  );
  const [modelBindingId, setModelBindingId] = useState(initialModelBindingId);
  const configuredReasoning = policy.modelIntent.reasoning ?? "default";
  const [reasoning, setReasoning] = useState<ReasoningLevel>(
    normalizeReasoningLevel(
      configuredReasoning,
      initialRuntime,
      initialModelBindingId,
    ),
  );
  const [sessionPolicy, setSessionPolicy] = useState(policy.sessionPolicy);
  const [pending, setPending] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const modelOptions = runtimeModelOptions(selectedRuntime);
  const reasoningOptions = supportedReasoningLevels(
    selectedRuntime,
    modelBindingId,
  );
  useEffect(() => {
    const normalizedBinding = normalizeModelBindingId(
      modelBindingId,
      selectedRuntime,
    );
    if (normalizedBinding !== modelBindingId) {
      setModelBindingId(normalizedBinding);
    }
    setReasoning((current) =>
      normalizeReasoningLevel(current, selectedRuntime, normalizedBinding),
    );
  }, [modelBindingId, selectedRuntime]);
  const valid =
    displayName.trim() !== "" &&
    /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(handle.trim()) &&
    role.trim() !== "" &&
    instructions.trim() !== "" &&
    runtimeOfferId !== "";
  const runAction = (action: () => Promise<void>) => {
    setPending(true);
    setActionError(undefined);
    void action()
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => setPending(false));
  };

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Agent 设置窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-agent-manage-title"
        aria-modal="true"
        className="rah-dialog rah-agent-create-dialog rah-agent-manage-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>AGENT</p>
            <h2 id="rah-agent-manage-title">设置 {revision.displayName}</h2>
            <p>
              @{detail.agent.handle} · 版本 {revision.revision}
            </p>
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
            runAction(() =>
              onConfigure({
                avatarKey,
                ...(description.trim() === ""
                  ? {}
                  : { description: description.trim() }),
                displayName: displayName.trim(),
                handle: handle.trim(),
                instructions: instructions.trim(),
                modelIntent: modelIntent(modelBindingId, reasoning),
                role: role.trim(),
                runtimeOfferId,
                sessionPolicy,
              }),
            );
          }}
        >
          <div className="rah-agent-form-grid">
            <label>
              显示名称
              <input
                autoFocus
                maxLength={128}
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            <label>
              Handle
              <input
                maxLength={64}
                onChange={(event) =>
                  setHandle(handleFromName(event.target.value))
                }
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
            <label>
              模型
              <select
                onChange={(event) => {
                  const next = event.target.value;
                  setModelBindingId(next);
                  setReasoning((current) =>
                    normalizeReasoningLevel(current, selectedRuntime, next),
                  );
                }}
                value={modelBindingId}
              >
                {modelOptions.map((option) => (
                  <option
                    key={option.modelBindingId}
                    value={option.modelBindingId}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              {configuredModelBindingId !== undefined &&
              configuredModelBindingId !== modelBindingId ? (
                <small>
                  旧模型绑定没有当前 Runtime 证据；保存时将恢复为 Runtime 默认。
                </small>
              ) : null}
            </label>
          </div>
          <label>
            角色
            <input
              maxLength={512}
              onChange={(event) => setRole(event.target.value)}
              value={role}
            />
          </label>
          <label>
            描述（可选）
            <textarea
              maxLength={2_000}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              value={description}
            />
          </label>
          <label>
            Agent 指令
            <textarea
              maxLength={64 * 1_024}
              onChange={(event) => setInstructions(event.target.value)}
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
                {reasoningOptions.map((level) => (
                  <option key={level} value={level}>
                    {reasoningLabel(level)}
                  </option>
                ))}
              </select>
              {configuredReasoning !== "default" &&
              reasoningOptions.includes(configuredReasoning) === false ? (
                <small>
                  旧配置 {reasoningLabel(configuredReasoning)}
                  没有 Runtime 证据；保存时将恢复为 Runtime 默认。
                </small>
              ) : reasoningOptions.length === 1 ? (
                <small>当前模型未发布可执行的推理档位，将使用默认值。</small>
              ) : null}
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
          <div className="rah-agent-danger-actions">
            {detail.agent.definition.state === "enabled" ? (
              <button
                className="btn btn-orange"
                disabled={pending}
                onClick={() => runAction(() => onState("disabled"))}
                type="button"
              >
                暂停 Agent
              </button>
            ) : (
              <>
                <button
                  className="btn btn-green"
                  disabled={pending}
                  onClick={() => runAction(() => onState("enabled"))}
                  type="button"
                >
                  恢复 Agent
                </button>
                <button
                  className="btn btn-red"
                  disabled={pending}
                  onClick={() => setDeleteArmed(true)}
                  type="button"
                >
                  删除 Agent
                </button>
                {deleteArmed ? (
                  <div className="rah-agent-delete-confirm">
                    <strong>
                      删除后将移出所有 Room，并撤销 Runtime 授权。
                    </strong>
                    <button
                      className="btn btn-red"
                      disabled={pending}
                      onClick={() => runAction(() => onState("tombstoned"))}
                      type="button"
                    >
                      确认删除
                    </button>
                    <button
                      className="btn"
                      disabled={pending}
                      onClick={() => setDeleteArmed(false)}
                      type="button"
                    >
                      返回
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
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
              {pending ? "正在保存…" : "保存更改"}
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

function reasoningLabel(reasoning: ReasoningLevel): string {
  if (reasoning === "default") return "Runtime 默认";
  return reasoning[0]!.toUpperCase() + reasoning.slice(1);
}

function modelIntent(
  modelBindingId: string,
  reasoning: ReasoningLevel,
): ClientAgentProvisionRequest["modelIntent"] {
  return {
    fallback: "disabled",
    ...(modelBindingId === "runtime_default"
      ? {}
      : { exactBindingIds: [modelBindingId] }),
    reasoning,
  };
}
