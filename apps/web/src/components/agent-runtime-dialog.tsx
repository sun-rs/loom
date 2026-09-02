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
  runtimeReasoningOptions,
  runtimeToolAccessModes,
} from "../agent-runtime-capabilities.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { Icon } from "./icon.tsx";
import type { AgentConfigureInput } from "./agent-dialogs.tsx";

/** Raft's profile edit entry; the existing agent.manage command owns persistence. */
export function AgentRuntimeDialog({
  detail,
  runtimes,
  onConfigure,
  onClose,
}: {
  detail: ClientAgentGetResponse;
  runtimes: readonly LocalRuntimeInventoryEntry[];
  onConfigure: (input: AgentConfigureInput) => Promise<void>;
  onClose: () => void;
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
    detail.policy.modelIntent.exactBindingIds?.[0] ?? "runtime_default",
  );
  const [reasoning, setReasoning] = useState<ReasoningLevel>(
    detail.policy.modelIntent.reasoning ?? "default",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const runtime = options.find(
    (candidate) => candidate.runtimeOfferId === offerId,
  );
  const models = runtimeModelOptions(runtime);
  const efforts = runtimeReasoningOptions(runtime, bindingId);
  const valid =
    runtime !== undefined &&
    models.some((model) => model.modelBindingId === bindingId) &&
    efforts.some((effort) => effort.value === reasoning);
  const changed =
    offerId !== detail.policy.required.allowedOfferIds?.[0] ||
    bindingId !==
      (detail.policy.modelIntent.exactBindingIds?.[0] ?? "runtime_default") ||
    reasoning !== (detail.policy.modelIntent.reasoning ?? "default");

  async function save() {
    if (!valid || !changed || saving.current) return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    const revision = detail.agent.currentRevision;
    try {
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
          exactBindingIds:
            bindingId === "runtime_default" ? undefined : [bindingId],
          fallback: "disabled",
          reasoning,
        },
        toolAccessMode: DEFAULT_TOOL_ACCESS_MODE,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
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
        disabled={pending}
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
            disabled={pending}
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
            disabled={pending}
            value={offerId}
            options={options.map((item) => ({
              id: item.runtimeOfferId!,
              label: item.displayName,
            }))}
            onChange={(next) => {
              setOfferId(next);
              setBindingId("runtime_default");
              setReasoning("default");
            }}
          />
          <RuntimePicker
            label="模型"
            disabled={pending || runtime === undefined}
            value={bindingId}
            options={models.map((item) => ({
              id: item.modelBindingId,
              label: item.label,
            }))}
            onChange={(next) => {
              setBindingId(next);
              setReasoning((current) =>
                normalizeReasoningLevel(current, runtime, next),
              );
            }}
          />
          <RuntimePicker
            label="推理强度"
            disabled={pending || runtime === undefined}
            value={reasoning}
            options={efforts.map((item) => ({
              id: item.value,
              label: item.label,
            }))}
            onChange={(next) => setReasoning(next as ReasoningLevel)}
          />
          {!valid && (
            <p role="status">
              当前配置缺少可用的 Runtime
              或模型证据。请选择可用配置；不会自动替换成默认值。
            </p>
          )}
          <p className="rah-runtime-edit-note">
            新配置从下一次执行生效。Agent 身份、人设和私有记忆保持不变。
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
              disabled={pending}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={!valid || !changed || pending}
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
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <div className="rah-runtime-edit-field">
      <b>
        {label}
        {required && <em> *</em>}
      </b>
      <DiscoveryFilter
        label={label}
        triggerAriaLabel={`${label}：${options.find((item) => item.id === value)?.label ?? "配置不可用"}`}
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
          options.find((item) => item.id === value)?.label ?? "配置不可用"
        }
        onChange={(values) => {
          if (values[0] !== undefined) onChange(values[0]);
        }}
      />
    </div>
  );
}
