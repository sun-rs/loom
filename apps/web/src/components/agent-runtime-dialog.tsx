import { RuntimeFastMode } from "./runtime-fast-mode.tsx";
import {
  modelIntentDraft,
  selectedModelIntent,
} from "../runtime-model-selection.ts";
import { runtimeProductLabel } from "../agent-runtime-presentation.ts";
import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { useAgentEnvironmentDraft } from "../use-agent-environment-draft.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { AgentLaunchSettingsEditor } from "./agent-launch-settings-editor.tsx";
import { useRef, useState } from "react";
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
  runtimeReasoningNotice,
  runtimeToolAccessModes,
} from "../agent-runtime-capabilities.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { RuntimePicker } from "./runtime-picker.tsx";
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
    modelIntentDraft(detail.policy.modelIntent),
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
    detail.agent.definition.agentId,
    runtime?.cliId,
  );
  const models = runtimeModelOptions(runtime, bindingId);
  const efforts = runtimeReasoningOptions(runtime, bindingId);
  const fastTier = runtimeFastTier(runtime, bindingId);
  const valid =
    (serviceTier === "default" || serviceTier === fastTier) &&
    runtime !== undefined &&
    models.some((model) => model.modelBindingId === bindingId) &&
    efforts.some((effort) => effort.value === reasoning);
  const changed =
    offerId !== detail.policy.required.allowedOfferIds?.[0] ||
    bindingId !== modelIntentDraft(detail.policy.modelIntent) ||
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
            ...selectedModelIntent(bindingId, reasoning),
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
    <DialogLayer className="rah-dialog-layer" role="presentation">
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
              label: runtimeProductLabel(item),
            }))}
            onChange={(next) => {
              setOfferId(next);
              setBindingId("");
              setReasoning("default");
              setServiceTier("default");
            }}
          />
          <RuntimePicker
            label="模型"
            key={runtime?.cliId}
            customRuntime={runtime?.customModelRuntime}
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
              nativeId: item.nativeId,
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
            belowControl={
              runtimeReasoningNotice(runtime, bindingId) ? (
                <small>{runtimeReasoningNotice(runtime, bindingId)}</small>
              ) : undefined
            }
            disabled={
              pending || refreshing || savingLaunch || runtime === undefined
            }
            value={reasoning}
            options={efforts.map((item) => ({
              id: item.value,
              label: item.label,
              description: item.description,
            }))}
            onChange={(next) => setReasoning(next as ReasoningLevel)}
          />
          {fastTier && (
            <div className="rah-runtime-edit-field">
              <b>模式</b>
              <RuntimeFastMode
                checked={serviceTier === fastTier}
                disabled={pending || refreshing || savingLaunch}
                onChange={(checked) =>
                  setServiceTier(checked ? fastTier : "default")
                }
              />
            </div>
          )}
          <AgentLaunchSettingsEditor
            draft={environmentDraft}
            blocked={pending || refreshing}
          />
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
    </DialogLayer>
  );
}
