import RuntimeInfoChip from "./RuntimeInfoChip";
import MobileFormDialog from "./MobileFormDialog";
import RoleEditor from "./RoleEditor.tsx";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import {
  OfficialRoleHero,
  OfficialRoleIdentity,
} from "./OfficialComputerProfile.generated";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  RoleTemplate,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import { DescriptionList, Separator, Badge } from "raft-ui";
import { Pencil, Cpu } from "lucide-react";
import { roleFormFrom, runtimeChoices } from "@rah-os/client-core/role-form";
import { runtimeModelOptions } from "./runtime-model-options";
import RoleFieldEditor, { type RoleField } from "./RoleFieldEditor.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import type { RoleCreateRequest } from "@rah-os/protocol";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
import SectionEyebrow from "@loom/raft-web-source/SectionEyebrow";
import AvatarEditVeil from "@loom/raft-web-source/AvatarEditVeil";
import { rolePresentation } from "./role-profile-values";
import {
  InfoRow,
  AgentHeaderName,
  PROFILE_AVATAR_BUTTON_CLASS,
  RUNTIME_CHIP_CLASS,
  INFO_ICON_BUTTON_CLASS,
} from "./OfficialProfile.generated";
export default function RoleProfile({
  client,
  role,
  disabled,
  onSave,
  onDirtyChange,
}: {
  client: RahClient;
  role: RoleTemplate;
  disabled: boolean;
  onSave: (configuration: RoleCreateRequest["configuration"]) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const textFocus = useRef<HTMLTextAreaElement | null>(null);
  const runtimeContainer = useRef<HTMLDivElement | null>(null);
  const [runtimeDirty, setRuntimeDirty] = useState(false);
  const [discardRuntime, setDiscardRuntime] = useState(false);
  const [field, setField] = useState<RoleField>();
  const [fieldDirty, setFieldDirty] = useState(false),
    [discardField, setDiscardField] = useState(false);
  // This profile owns editor lifetime. A confirmed revision replaces its keyed
  // profile; unmount must release its parent navigation mark as well as its draft.
  useLayoutEffect(() => {
    onDirtyChange(fieldDirty || runtimeDirty);
    return () => onDirtyChange(false);
  }, [fieldDirty, runtimeDirty, onDirtyChange]);
  const nameAction = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const edit = (next: RoleField, button: HTMLButtonElement) => {
    trigger.current = button;
    setField(next);
  };
  const cancel = () => {
    setField(undefined);
    setFieldDirty(false);
    setRuntimeDirty(false);
    setDiscardField(false);
    setDiscardRuntime(false);
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else nameAction.current?.querySelector("button")?.focus();
    });
  };
  const requestCloseField = () => {
    if (disabled) return;
    if (fieldDirty) setDiscardField(true);
    else cancel();
  };
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState<LocalRuntimeInventoryResponse>();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("host.runtime.list", {}, { signal: abort.signal })
      .then((v) => {
        if (!abort.signal.aborted) setInventory(v);
      })
      .catch(() => {
        if (!abort.signal.aborted) setInventory(undefined);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client]);
  const form = roleFormFrom(role.configuration);
  const presentation = rolePresentation(role.configuration, inventory);
  const runtime = inventory?.runtimes.find(
    (r) => r.runtimeOfferId === form.runtimeOfferId,
  );
  const model = runtime?.modelBindingDescriptors.find(
    (b) => b.modelBindingId === form.modelBindingId,
  );
  const choice =
    inventory &&
    runtimeChoices(inventory).find(
      (r) => r.runtimeOfferId === form.runtimeOfferId,
    );
  const displayModel =
    choice &&
    runtimeModelOptions(choice).find((group) =>
      group.variants.some((b) => b.modelBindingId === form.modelBindingId),
    );
  const fastMode =
    displayModel?.fastBindingIds?.includes(form.modelBindingId) ||
    ["fast", "priority"].includes(form.serviceTier ?? "");
  const { formatShortDateTime } = useTimeFormatter();
  const editor = (current: RoleField) => (
    <RoleFieldEditor
      key={current}
      field={current}
      role={role}
      client={client}
      disabled={disabled}
      onSave={onSave}
      onCancel={
        current === "description" ||
        current === "instructions" ||
        current === "avatarKey"
          ? requestCloseField
          : cancel
      }
      onDiscard={cancel}
      initialFocusRef={textFocus}
      descriptionPlaceholder={presentation.fallback}
      onDirtyChange={setFieldDirty}
    />
  );
  const editAction = (current: RoleField, label: string) => (
    <Tooltip content={`编辑${label}`}>
      <button
        type="button"
        aria-label={`编辑${label}`}
        disabled={disabled || Boolean(field)}
        onClick={(e) => edit(current, e.currentTarget)}
        className={INFO_ICON_BUTTON_CLASS}
      >
        <Pencil size={14} />
      </button>
    </Tooltip>
  );
  // Composition port: AgentDetailPanel profile hero / description / info / runtime.
  // Role configuration has no live presence or unique native session handle.
  return (
    <div data-testid="loom-role-profile" className="font-sans bg-layer-canvas">
      <OfficialRoleHero data-testid="role-profile-hero">
        <Tooltip content="更换头像">
          <button
            type="button"
            aria-label="更换头像"
            disabled={disabled || Boolean(field)}
            onClick={(e) => edit("avatarKey", e.currentTarget)}
            className={PROFILE_AVATAR_BUTTON_CLASS}
          >
            <AvatarSlot
              context="profile-hero"
              type="agent"
              agentAvatarUrl={role.configuration.avatarKey}
            />
            <AvatarEditVeil icon={Pencil} />
          </button>
        </Tooltip>
        <OfficialRoleIdentity data-testid="role-profile-identity">
          <div ref={nameAction} className="flex min-w-0 items-center gap-2">
            <AgentHeaderName
              agent={{ name: role.configuration.displayName }}
              onEdit={
                !disabled && !field
                  ? () => {
                      const button =
                        nameAction.current?.querySelector("button");
                      if (button) edit("displayName", button);
                    }
                  : undefined
              }
            />
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge appearance="outline">角色</Badge>
            <Badge
              appearance="soft"
              variant="information"
              className={RUNTIME_CHIP_CLASS}
            >
              <Cpu size={14} aria-hidden="true" />
              {runtime?.displayName ?? (loading ? "读取中…" : "当前配置不可用")}
            </Badge>
          </div>
          <p className="mt-1.5 text-footnote text-foreground-hint">
            修改保存为新的角色修订；已有实例保持原配置。
          </p>
        </OfficialRoleIdentity>
      </OfficialRoleHero>
      {field === "displayName" && (
        <div className="px-5 pb-4">{editor(field)}</div>
      )}
      <section data-testid="role-profile-prompt" className="px-5 py-3">
        <div className="flex items-center gap-2 mb-1">
          <SectionEyebrow as="div">描述</SectionEyebrow>
          {editAction("description", "描述")}
        </div>
        <p
          data-testid="role-description"
          className={`text-subhead whitespace-pre-wrap break-words ${role.configuration.description?.trim() ? "text-foreground" : "text-foreground-hint"}`}
        >
          {presentation.description}
        </p>
        <div className="mt-4 flex items-center gap-2 mb-1">
          <SectionEyebrow as="div">提示词</SectionEyebrow>
          {editAction("instructions", "提示词")}
        </div>
        <p
          data-testid="role-instructions"
          className="text-subhead text-foreground whitespace-pre-wrap break-words"
        >
          {form.instructions || (
            <span className="text-foreground-hint">未设置</span>
          )}
        </p>
      </section>
      {(field === "description" ||
        field === "instructions" ||
        field === "avatarKey") && (
        <MobileFormDialog
          title={field !== "avatarKey" ? "编辑描述与提示词" : "更换头像"}
          testId={
            field !== "avatarKey"
              ? "role-description-dialog"
              : "role-avatar-dialog"
          }
          busy={disabled}
          initialFocus={textFocus}
          onClose={requestCloseField}
        >
          {editor(field)}
        </MobileFormDialog>
      )}
      {discardField && (
        <ConfirmDialog
          layer={2}
          title="尚未保存的修改"
          message="离开将放弃尚未保存的修改。"
          confirmLabel="放弃修改"
          cancelLabel="继续编辑"
          confirmVariant="danger"
          onClose={() => setDiscardField(false)}
          onConfirm={cancel}
        />
      )}
      <Separator />
      <section className="px-5 py-4">
        <SectionEyebrow as="div" className="mb-3">
          信息
        </SectionEyebrow>
        <DescriptionList direction="horizontal">
          <InfoRow label="创建时间">
            {formatShortDateTime(role.createdAt)}
          </InfoRow>
          <InfoRow label="修改时间">
            {role.updatedAt ? formatShortDateTime(role.updatedAt) : "未记录"}
          </InfoRow>
        </DescriptionList>
      </section>
      <Separator />
      <section data-testid="role-profile-runtime" className="px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <SectionEyebrow as="div">运行时配置</SectionEyebrow>
          {editAction("runtimeOfferId", "运行时配置")}
        </div>
        <DescriptionList direction="horizontal">
          <InfoRow label="运行时">
            <RuntimeInfoChip
              key={form.runtimeOfferId}
              runtime={runtime}
              loading={loading}
              className={RUNTIME_CHIP_CLASS}
            />
          </InfoRow>
          <InfoRow label="模型">
            <span className="min-w-0 break-all font-mono">
              {(displayModel?.label ??
                model?.displayName ??
                model?.modelId ??
                form.modelBindingId) ||
                "未指定"}
            </span>
          </InfoRow>
          <InfoRow label="推理强度">{form.reasoning || "默认／不适用"}</InfoRow>
          <InfoRow label="模式">{fastMode ? "快速模式" : "默认"}</InfoRow>
        </DescriptionList>
      </section>
      {field === "runtimeOfferId" && (
        <MobileFormDialog
          title="编辑运行时配置"
          testId="agent-runtime-config-dialog"
          busy={disabled}
          containerRef={runtimeContainer}
          onClose={() => {
            if (!disabled) {
              if (runtimeDirty) setDiscardRuntime(true);
              else cancel();
            }
          }}
        >
          <RoleEditor
            client={client}
            role={role}
            field="runtimeOfferId"
            portalContainer={runtimeContainer}
            disabled={disabled}
            onSave={onSave}
            onDirtyChange={setRuntimeDirty}
            onCancel={() => (runtimeDirty ? setDiscardRuntime(true) : cancel())}
            onNavigationDiscard={cancel}
          />
        </MobileFormDialog>
      )}
      {discardRuntime && (
        <ConfirmDialog
          layer={2}
          title="尚未保存的修改"
          message="离开将放弃尚未保存的修改。"
          confirmLabel="放弃修改"
          cancelLabel="继续编辑"
          confirmVariant="danger"
          onClose={() => setDiscardRuntime(false)}
          onConfirm={() => {
            setDiscardRuntime(false);
            setRuntimeDirty(false);
            cancel();
          }}
        />
      )}
    </div>
  );
}
