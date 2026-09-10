import { useEffect, useMemo, useState } from "react";

import type {
  ClientAgentGetResponse,
  ClientAgentManageRequest,
  ClientAgentProvisionRequest,
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
} from "@rah-os/protocol";

import {
  DEFAULT_TOOL_ACCESS_MODE,
  normalizeModelBindingId,
  normalizeReasoningLevel,
  runtimeModelOptions,
  runtimeReasoningOptions,
  runtimeToolAccessModes,
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
  computerLabel,
  onClose,
  onCreate,
  runtimes,
}: {
  computerLabel: string | undefined;
  onClose: () => void;
  onCreate: (input: AgentCreateInput) => Promise<void>;
  runtimes: readonly LocalRuntimeInventoryEntry[];
}) {
  const runtimeOptions = useMemo(
    () =>
      runtimes.filter(
        (runtime) =>
          runtime.available &&
          runtime.configured &&
          runtime.runtimeOfferId !== undefined &&
          runtimeToolAccessModes(runtime).includes(DEFAULT_TOOL_ACCESS_MODE),
      ),
    [runtimes],
  );
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [avatarKey, setAvatarKey] = useState<string>("");
  const [runtimeOfferId, setRuntimeOfferId] = useState("");
  const [modelBindingId, setModelBindingId] = useState("runtime_default");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("default");
  const [showMore, setShowMore] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const modelOptions = runtimeModelOptions(selectedRuntime);
  const reasoningOptions = runtimeReasoningOptions(
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
    runtimeOfferId !== "";
  const effectiveRole =
    role.trim() || description.trim() || `${displayName.trim()} Agent`;
  const effectiveInstructions =
    instructions.trim() ||
    description.trim() ||
    "作为通用 Agent，遵循用户指令并清晰报告执行结果。";

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
          <h2 id="rah-agent-create-title">创建 AGENT</h2>
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
              ...(avatarKey === "" ? {} : { avatarKey }),
              ...(description.trim() === ""
                ? {}
                : { description: description.trim() }),
              displayName: displayName.trim(),
              handle: handle.trim(),
              instructions: effectiveInstructions,
              modelIntent: modelIntent(modelBindingId, reasoning),
              role: effectiveRole,
              runtimeOfferId,
              toolAccessMode: DEFAULT_TOOL_ACCESS_MODE,
            })
              .then(() => setActionError(undefined))
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            <span>
              计算机 <em>*</em>
            </span>
            <select disabled value={computerLabel ?? ""}>
              {computerLabel === undefined ? (
                <option value="">没有在线的计算机</option>
              ) : (
                <option value={computerLabel}>{computerLabel}</option>
              )}
            </select>
          </label>
          <label>
            <span>
              名称 <em>*</em>
            </span>
            <input
              autoFocus
              maxLength={128}
              onChange={(event) => {
                const nextName = event.target.value;
                setDisplayName(nextName);
                if (!handleEdited) setHandle(handleFromName(nextName));
              }}
              placeholder="例如 Alice"
              value={displayName}
            />
          </label>
          <label>
            描述
            <textarea
              maxLength={3_000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="留空作为通用 Agent，或描述一个角色…"
              rows={4}
              value={description}
            />
            <small className="rah-agent-description-count">
              {description.length}/3000
            </small>
          </label>
          <label>
            <span>
              运行时 <em>*</em>
            </span>
            <select
              onChange={(event) => setRuntimeOfferId(event.target.value)}
              value={runtimeOfferId}
            >
              <option value="">请选择…</option>
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
            {runtimeOfferId === "" ? (
              <small>
                请选择一台在线的 Computer 以及运行时以检查可用模型。
              </small>
            ) : null}
          </label>
          <button
            aria-expanded={showMore}
            className="rah-agent-disclosure"
            onClick={() => {
              setShowMore((current) => !current);
              if (showMore) setShowAdvanced(false);
            }}
            type="button"
          >
            <span aria-hidden="true">{showMore ? "⌄" : "›"}</span> 更多
          </button>
          {showMore ? (
            <section className="rah-agent-more-fields">
              <button
                aria-expanded={showAdvanced}
                className="rah-agent-disclosure is-nested"
                onClick={() => setShowAdvanced((current) => !current)}
                type="button"
              >
                <span aria-hidden="true">{showAdvanced ? "⌄" : "›"}</span> 高级
              </button>
              {showAdvanced ? (
                <div className="rah-agent-advanced-fields">
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
                      <option value="">官方头像库自动分配（优先未使用）</option>
                      {RAFT_AVATAR_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    人设指令
                    <input
                      maxLength={512}
                      onChange={(event) => setRole(event.target.value)}
                      placeholder="留空时使用名称与描述"
                      value={role}
                    />
                  </label>
                  <label>
                    Agent 指令
                    <textarea
                      maxLength={64 * 1_024}
                      onChange={(event) => setInstructions(event.target.value)}
                      placeholder="留空时作为通用 Agent"
                      rows={4}
                      value={instructions}
                    />
                  </label>
                  <label>
                    推理强度
                    <select
                      onChange={(event) =>
                        setReasoning(event.target.value as typeof reasoning)
                      }
                      value={reasoning}
                    >
                      {reasoningOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </section>
          ) : null}
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
          runtime.runtimeOfferId !== undefined &&
          runtimeToolAccessModes(runtime).includes(DEFAULT_TOOL_ACCESS_MODE),
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
  const [avatarKey, setAvatarKey] = useState(
    revision.avatarKey ??
      `random:agent:${detail.agent.definition.participantId}`,
  );
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
  const [pending, setPending] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const modelOptions = runtimeModelOptions(selectedRuntime);
  const reasoningOptions = runtimeReasoningOptions(
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
    runtimeOfferId !== "";
  const effectiveInstructions =
    instructions.trim() ||
    revision.instructions?.trim() ||
    revision.role.trim();
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
                instructions: effectiveInstructions,
                modelIntent: modelIntent(modelBindingId, reasoning),
                role: role.trim(),
                runtimeOfferId,
                toolAccessMode: DEFAULT_TOOL_ACCESS_MODE,
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
                {!RAFT_AVATAR_KEYS.some((key) => key === avatarKey) && (
                  <option value={avatarKey}>当前头像</option>
                )}
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
            人设指令
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
                {reasoningOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {configuredReasoning !== "default" &&
              reasoningOptions.some(
                (option) => option.value === configuredReasoning,
              ) === false ? (
                <small>
                  旧配置 {reasoningLabel(configuredReasoning)}
                  没有 Runtime 证据；保存时将恢复为 Runtime 默认。
                </small>
              ) : reasoningOptions.length === 1 ? (
                <small>当前模型未发布可执行的推理档位，将使用默认值。</small>
              ) : null}
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
