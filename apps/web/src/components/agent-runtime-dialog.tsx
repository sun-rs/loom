import { useAgentEnvironmentDraft } from "../use-agent-environment-draft.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { AgentLaunchSettingsEditor } from "./agent-launch-settings-editor.tsx";
import { AgentProviderEditor, providerKeys } from "./agent-provider-editor.tsx";
import { useRef, useState, type ReactNode } from "react";
import type {
  ClientAgentGetResponse,
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
} from "@rah-os/protocol";
import {
  DEFAULT_TOOL_ACCESS_MODE,
  normalizeReasoningLevel,
  runtimeModelOptions,
  runtimeFastTier,
  runtimeReasoningOptions,
  runtimeToolAccessModes,
} from "../agent-runtime-capabilities.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import type { AgentConfigureInput } from "./agent-dialogs.tsx";

/** Raft's profile edit entry; the existing agent.manage command owns persistence. */
export function AgentRuntimeDialog({
  detail,
  onLaunchSaved,
  client,
  runtimes,
  onConfigure,
  onRefreshModels,
  onClose,
}: {
  onLaunchSaved?: () => void;
  detail: ClientAgentGetResponse;
  client: RahClient;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  onConfigure: (input: AgentConfigureInput) => Promise<void>;
  onClose: () => void;
  onRefreshModels: (offerId: string) => Promise<void>;
}) {
  const options = runtimes.filter(
    (runtime) =>
      runtime.available &&
      runtime.configured &&
      runtime.runtimeOfferId !== undefined &&
      runtimeToolAccessModes(runtime).includes(DEFAULT_TOOL_ACCESS_MODE),
  );
  const [offerId, setOfferId] = useState(
    detail.policy.required.allowedOfferIds?.[0] ?? "",
  );
  const [bindingId, setBindingId] = useState(
    detail.policy.modelIntent.exactBindingIds?.[0] ?? "",
  );
  const [reasoning, setReasoning] = useState<ReasoningLevel>(
    detail.policy.modelIntent.reasoning ?? "default",
  );
  const [serviceTier, setServiceTier] = useState(
    detail.policy.modelIntent.serviceTier ?? "default",
  );
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const savingLaunch = false;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const dialogRef = useDialogProtocol({
    blocked: pending || savingLaunch,
    onClose,
  });
  const runtime = options.find(
    (candidate) => candidate.runtimeOfferId === offerId,
  );
  const environmentDraft = useAgentEnvironmentDraft(
    client,
    detail.agent.definition.agentDefinitionId,
    runtime?.cliId,
  );
  const models = runtimeModelOptions(runtime);
  const efforts = runtimeReasoningOptions(runtime, bindingId);
  const fastTier = runtimeFastTier(runtime, bindingId);
  const valid =
    (serviceTier === "default" || serviceTier === fastTier) &&
    runtime !== undefined &&
    models.some((model) => model.modelBindingId === bindingId) &&
    efforts.some((effort) => effort.value === reasoning);
  const changed =
    offerId !== detail.policy.required.allowedOfferIds?.[0] ||
    bindingId !== (detail.policy.modelIntent.exactBindingIds?.[0] ?? "") ||
    reasoning !== (detail.policy.modelIntent.reasoning ?? "default") ||
    serviceTier !== (detail.policy.modelIntent.serviceTier ?? "default");

  async function save() {
    if (
      !valid ||
      (!changed && !environmentDraft.dirty) ||
      !environmentDraft.ready ||
      saving.current ||
      refreshLock.current ||
      savingLaunch
    )
      return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    const revision = detail.agent.currentRevision;
    let environmentSaved = false;
    try {
      environmentSaved = await environmentDraft.save();
      if (environmentSaved) onLaunchSaved?.();
      if (changed)
        await onConfigure({
          ...(revision.avatarKey === undefined
            ? {}
            : { avatarKey: revision.avatarKey }),
          ...(revision.description === undefined
            ? {}
            : { description: revision.description }),
          displayName: revision.displayName ?? detail.agent.handle,
          handle: detail.agent.handle,
          role: revision.role,
          // Legacy definitions without instructions use the same established fallback.
          instructions: revision.instructions ?? revision.role,
          runtimeOfferId: offerId,
          modelIntent: {
            ...detail.policy.modelIntent,
            exactBindingIds: [bindingId],
            fallback: "disabled",
            reasoning,
            serviceTier,
          },
          toolAccessMode: DEFAULT_TOOL_ACCESS_MODE,
        });
      else onClose();
    } catch (caught) {
      setError(
        (environmentSaved ? "环境变量已保存；运行时配置保存失败：" : "") +
          (caught instanceof Error ? caught.message : "保存失败"),
      );
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭运行时配置"
        disabled={pending || savingLaunch}
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-runtime-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rah-runtime-edit-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-runtime-edit-title">编辑运行时配置</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending || savingLaunch}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <RuntimePicker
            label="运行时"
            required
            disabled={pending || refreshing || savingLaunch}
            value={offerId}
            options={options.map((item) => ({
              id: item.runtimeOfferId!,
              label: item.displayName,
            }))}
            onChange={(next) => {
              setOfferId(next);
              setBindingId("");
              setReasoning("default");
              setServiceTier("default");
            }}
          />
          <AgentProviderEditor
            runtimeId={runtime?.cliId}
            rows={environmentDraft.rows}
            onChange={environmentDraft.setRows}
            disabled={pending || refreshing || !environmentDraft.ready}
          />
          <RuntimePicker
            label="模型"
            belowControl={
              refreshing && (
                <p className="rah-runtime-model-status" role="status">
                  正在检查此计算机上的模型…
                </p>
              )
            }
            action={
              <button
                className="rah-runtime-model-refresh"
                type="button"
                aria-label="刷新模型"
                aria-busy={refreshing}
                disabled={pending || refreshing || savingLaunch || !runtime}
                onClick={async () => {
                  if (refreshLock.current) return;
                  refreshLock.current = true;
                  setRefreshing(true);
                  setError(undefined);
                  try {
                    await onRefreshModels(offerId);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "刷新模型失败",
                    );
                  } finally {
                    refreshLock.current = false;
                    setRefreshing(false);
                  }
                }}
              >
                <Icon name="refresh-cw" />
              </button>
            }
            required
            disabled={
              pending || refreshing || savingLaunch || runtime === undefined
            }
            value={bindingId}
            options={models.map((item) => ({
              id: item.modelBindingId,
              label: item.label,
            }))}
            onChange={(next) => {
              setBindingId(next);
              setServiceTier("default");
              setReasoning((current) =>
                normalizeReasoningLevel(current, runtime, next),
              );
            }}
          />
          <RuntimePicker
            label="推理强度"
            disabled={
              pending || refreshing || savingLaunch || runtime === undefined
            }
            value={reasoning}
            options={efforts.map((item) => ({
              id: item.value,
              label: item.label,
            }))}
            onChange={(next) => setReasoning(next as ReasoningLevel)}
          />
          {fastTier && (
            <div className="rah-runtime-edit-field">
              <b>模式</b>
              <label className="rah-runtime-fast-mode">
                <span className="rah-runtime-fast-check">
                  <input
                    type="checkbox"
                    aria-labelledby="runtime-fast-mode-title"
                    aria-describedby="runtime-fast-mode-description"
                    checked={serviceTier === fastTier}
                    disabled={pending || refreshing || savingLaunch}
                    onChange={(event) =>
                      setServiceTier(
                        event.target.checked ? fastTier : "default",
                      )
                    }
                  />
                  <Icon name="check" />
                </span>
                <b id="runtime-fast-mode-title">快速模式</b>
                <span id="runtime-fast-mode-description">
                  以更高的单 token 成本换取更快速度启动此运行时。
                </span>
              </label>
            </div>
          )}
          <AgentLaunchSettingsEditor
            hiddenKeys={runtime?.cliId === "claude" ? providerKeys : []}
            draft={environmentDraft}
            blocked={pending || refreshing}
          />
          {!valid && (
            <p role="status">
              当前配置缺少可用的 Runtime
              或模型证据。请选择可用配置；不会自动替换成默认值。
            </p>
          )}
          <p className="rah-runtime-edit-note">
            保存后立即更新配置，供后续新调度的执行使用；正在运行的执行不会热切换。Agent
            身份、人设和私有记忆保持不变。
          </p>
          {error && (
            <p className="rah-dialog-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              className="btn"
              type="button"
              disabled={pending || savingLaunch}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={
                !valid ||
                (!changed && !environmentDraft.dirty) ||
                !environmentDraft.ready ||
                pending ||
                refreshing
              }
            >
              {pending ? "正在保存…" : "保存运行时配置"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function RuntimePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  required = false,
  action,
  belowControl,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
  action?: ReactNode;
  belowControl?: ReactNode;
}) {
  return (
    <div className="rah-runtime-edit-field">
      <b
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>
          {label}
          {required && <em> *</em>}
        </span>
        {action}
      </b>
      <DiscoveryFilter
        label={label}
        triggerAriaLabel={`${label}：${options.find((item) => item.id === value)?.label ?? "请选择"}`}
        icon={null}
        values={[value]}
        options={options}
        multiple={false}
        clearable={false}
        selected={false}
        showCount={false}
        disabled={disabled}
        className="rah-runtime-picker"
        triggerLabel={
          options.find((item) => item.id === value)?.label ?? "请选择"
        }
        onChange={(values) => {
          if (values[0] !== undefined) onChange(values[0]);
        }}
      />
      {belowControl}
    </div>
  );
}
