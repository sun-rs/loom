import { RuntimeFastMode } from "./runtime-fast-mode.tsx";
import {
  modelIntentDraft,
  selectedModelIntent,
} from "../runtime-model-selection.ts";
import { runtimeProductLabel } from "../agent-runtime-presentation.ts";
import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { RuntimePicker } from "./runtime-picker.tsx";
import { RuntimeGuideIdSchema } from "@rah-os/protocol";
import { parseAgentEnvironment } from "../agent-launch-environment.ts";
import {
  RuntimeEnvironmentEditor,
  type EnvironmentRow,
} from "./runtime-environment-editor.tsx";

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
  runtimeFastTier,
  runtimeReasoningOptions,
  runtimeReasoningNotice,
  runtimeToolAccessModes,
} from "../agent-runtime-capabilities.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export type AgentCreateInput = Omit<
  ClientAgentProvisionRequest,
  "basedOnRoomSeq" | "controlRoomId" | "idempotencyKey"
>;
export type AgentConfigureInput = Omit<
  Extract<ClientAgentManageRequest, { action: "configure" }>,
  "action" | "agentId" | "basedOnRoomSeq" | "idempotencyKey"
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

function CreateAgentSelect(props: ComponentProps<"select">) {
  return (
    <span className="rah-create-agent-select">
      <select {...props} />
      <Icon name="chevron-down" />
    </span>
  );
}

export function AgentCreateDialog({
  client,
  computerLabel,
  autoJoinChannelName,
  onCreated,
  onClose,
  onCreate,
  onRefreshModels,
  runtimes,
}: {
  client: RahClient;
  computerLabel: string | undefined;
  autoJoinChannelName?: string | undefined;
  onCreated?: ((agentId: string) => Promise<void>) | undefined;
  onClose: () => void;
  onCreate: (input: AgentCreateInput) => Promise<string>;
  onRefreshModels: (offerId: string) => Promise<void>;
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
  const [description, setDescription] = useState("");
  const [runtimeOfferId, setRuntimeOfferId] = useState("");
  const [modelBindingId, setModelBindingId] = useState("");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("default");
  const [serviceTier, setServiceTier] = useState<
    "default" | "fast" | "priority"
  >("default");
  const [environmentRows, setEnvironmentRows] = useState<
    Record<string, EnvironmentRow[]>
  >({});
  const [createdAgentId, setCreatedAgentId] = useState<string>();
  const created = useRef<string | undefined>(undefined);
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({
    blocked: pending || refreshing,
    onClose,
  });
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.runtimeOfferId === runtimeOfferId,
  );
  const modelOptions = runtimeModelOptions(selectedRuntime, modelBindingId);
  const rows = environmentRows[runtimeOfferId] ?? [];
  const setRows = (next: EnvironmentRow[]) =>
    setEnvironmentRows((old) => ({ ...old, [runtimeOfferId]: next }));
  let environment: Record<string, string> = {};
  let environmentError: string | undefined;
  try {
    environment = parseAgentEnvironment(rows);
  } catch (error) {
    environmentError = errorMessage(error);
  }
  const fastTier = runtimeFastTier(selectedRuntime, modelBindingId);
  const handle = handleFromName(displayName) || "agent";
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
    !environmentError &&
    displayName.trim() !== "" &&
    /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(handle.trim()) &&
    runtimeOfferId !== "" &&
    modelOptions.some((option) => option.modelBindingId === modelBindingId);
  async function submit() {
    if (!valid || saving.current || refreshLock.current) return;
    saving.current = true;
    setPending(true);
    setActionError(undefined);
    try {
      if (!created.current) {
        created.current = await onCreate({
          ...(description.trim() ? { description: description.trim() } : {}),
          displayName: displayName.trim(),
          handle,
          instructions:
            description.trim() ||
            "作为通用 Agent，遵循用户指令并清晰报告执行结果。",
          role: `${displayName.trim()} Agent`,
          modelIntent: {
            ...modelIntent(modelBindingId, reasoning),
            serviceTier: fastTier ? serviceTier : "default",
          },
          runtimeOfferId,
          toolAccessMode: DEFAULT_TOOL_ACCESS_MODE,
        });
        setCreatedAgentId(created.current);
      }
      if (Object.keys(environment).length) {
        const runtimeId = RuntimeGuideIdSchema.parse(selectedRuntime?.cliId);
        const current = await client.request("runtime.guide.read", {
          agentId: created.current,
        });
        await client.request("runtime.guide.update", {
          agentId: created.current,
          runtimeId,
          environment,
          expectedRevision: current.revision,
        });
      }
      await onCreated?.(created.current!);
      onClose();
    } catch (error) {
      setActionError(
        (created.current
          ? "Agent 已创建，后续设置或加入频道尚未完成；重试不会重复创建。"
          : "") + errorMessage(error),
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <DialogLayer className="rah-dialog-layer" role="presentation">
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
            className="sq-btn rah-card-dialog-close"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {autoJoinChannelName && (
            <p className="rah-agent-create-channel">
              创建完成后将自动加入 #{autoJoinChannelName}
            </p>
          )}
          {actionError === undefined ? null : (
            <p className="rah-dialog-error rah-agent-create-error" role="alert">
              {actionError}
            </p>
          )}
          <fieldset
            className="rah-agent-create-fields"
            disabled={pending || refreshing || createdAgentId !== undefined}
          >
            <label>
              <span>
                计算机 <em>*</em>
              </span>
              <CreateAgentSelect disabled value={computerLabel ?? ""}>
                {computerLabel === undefined ? (
                  <option value="">没有在线的计算机</option>
                ) : (
                  <option value={computerLabel}>{computerLabel}</option>
                )}
              </CreateAgentSelect>
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
                }}
                placeholder="例如 Alice"
                value={displayName}
              />
            </label>
            <label>
              描述
              <textarea
                maxLength={2_000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="留空作为通用 Agent，或描述一个角色…"
                rows={3}
                value={description}
              />
              <small className="rah-agent-description-count">
                {description.length}/2000
              </small>
            </label>
            <RuntimePicker
              label="运行时"
              required
              disabled={pending || createdAgentId !== undefined}
              options={runtimeOptions.map((runtime) => ({
                id: runtime.runtimeOfferId!,
                label: runtimeProductLabel(runtime),
              }))}
              onChange={(next) => {
                setRuntimeOfferId(next);
                setServiceTier("default");
              }}
              value={runtimeOfferId}
            />
            <RuntimePicker
              label="模型"
              key={selectedRuntime?.cliId}
              customRuntime={selectedRuntime?.customModelRuntime}
              disabled={
                pending ||
                refreshing ||
                !selectedRuntime ||
                createdAgentId !== undefined
              }
              options={modelOptions.map((option) => ({
                id: option.modelBindingId,
                label: option.label,
                nativeId: option.nativeId,
              }))}
              action={
                <button
                  type="button"
                  className="rah-runtime-model-refresh"
                  aria-label="刷新模型"
                  disabled={pending || refreshing || !selectedRuntime}
                  onClick={async () => {
                    if (refreshLock.current) return;
                    refreshLock.current = true;
                    setRefreshing(true);
                    setActionError(undefined);
                    try {
                      await onRefreshModels(runtimeOfferId);
                    } catch (error) {
                      setActionError(errorMessage(error));
                    } finally {
                      refreshLock.current = false;
                      setRefreshing(false);
                    }
                  }}
                >
                  <Icon name="refresh-cw" />
                </button>
              }
              onChange={(next) => {
                setModelBindingId(next);
                setServiceTier("default");
                setReasoning((current) =>
                  normalizeReasoningLevel(current, selectedRuntime, next),
                );
              }}
              value={modelBindingId}
              belowControl={
                runtimeOfferId === "" ? (
                  <small>
                    请选择一台在线的 Computer 以及运行时以检查可用模型。
                  </small>
                ) : null
              }
            />
            <RuntimePicker
              label="推理强度"
              belowControl={
                runtimeReasoningNotice(selectedRuntime, modelBindingId) ? (
                  <small>
                    {runtimeReasoningNotice(selectedRuntime, modelBindingId)}
                  </small>
                ) : undefined
              }
              disabled={
                pending || createdAgentId !== undefined || !selectedRuntime
              }
              options={reasoningOptions.map((option) => ({
                id: option.value,
                label: option.label,
                description: option.description,
              }))}
              value={reasoning}
              onChange={(next) => setReasoning(next as ReasoningLevel)}
            />
            {fastTier && (
              <div className="rah-runtime-edit-field">
                <b>模式</b>
                <RuntimeFastMode
                  checked={serviceTier === fastTier}
                  disabled={pending || createdAgentId !== undefined}
                  onChange={(checked) =>
                    setServiceTier(checked ? fastTier : "default")
                  }
                />
              </div>
            )}
            <details className="rah-agent-launch-settings">
              <summary>更多</summary>
              <RuntimeEnvironmentEditor
                rows={rows}
                disabled={pending || createdAgentId !== undefined}
                onChange={setRows}
              />
            </details>
          </fieldset>
          {environmentError && <p role="alert">{environmentError}</p>}

          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={pending || refreshing || !valid}
            >
              {pending
                ? "正在保存…"
                : createdAgentId
                  ? autoJoinChannelName
                    ? "重试完成创建"
                    : "重试保存配置"
                  : "创建 Agent"}
            </button>
          </footer>
        </form>
      </section>
    </DialogLayer>
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
  const configuredModelBindingId = modelIntentDraft(policy.modelIntent);
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
  const modelOptions = runtimeModelOptions(selectedRuntime, modelBindingId);
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
    runtimeOfferId !== "" &&
    modelOptions.some((option) => option.modelBindingId === modelBindingId);
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
    <DialogLayer className="rah-dialog-layer" role="presentation">
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
              @{revision.displayName || detail.agent.handle} · 版本{" "}
              {revision.revision}
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
                    {runtimeProductLabel(runtime)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <RuntimePicker
                label="模型"
                key={selectedRuntime?.cliId}
                customRuntime={selectedRuntime?.customModelRuntime}
                disabled={pending || !selectedRuntime}
                value={modelBindingId}
                options={modelOptions.map((option) => ({
                  id: option.modelBindingId,
                  label: option.label,
                  nativeId: option.nativeId,
                }))}
                onChange={(next) => {
                  setModelBindingId(next);
                  setReasoning((current) =>
                    normalizeReasoningLevel(current, selectedRuntime, next),
                  );
                }}
              />
              {configuredModelBindingId !== undefined &&
              configuredModelBindingId !== modelBindingId ? (
                <small>
                  旧模型绑定没有当前 Runtime 证据；请明确选择模型后保存。
                </small>
              ) : null}
            </div>
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
                  没有 Runtime 证据；请明确选择模型后保存。
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
    </DialogLayer>
  );
}

function handleFromName(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[-._]+|[-._]+$/gu, "")
    .slice(0, 64);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reasoningLabel(reasoning: ReasoningLevel): string {
  if (reasoning === "default") return "默认";
  return reasoning[0]!.toUpperCase() + reasoning.slice(1);
}

function modelIntent(
  modelBindingId: string,
  reasoning: ReasoningLevel,
): ClientAgentProvisionRequest["modelIntent"] {
  return selectedModelIntent(modelBindingId, reasoning);
}
