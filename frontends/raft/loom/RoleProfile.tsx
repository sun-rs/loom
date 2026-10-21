import { useEffect, useState, useRef } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  RoleTemplate,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
import {
  DescriptionList,
  DescriptionItem,
  DescriptionTerm,
  DescriptionDetails,
} from "raft-ui";
import { Pencil } from "lucide-react";
import { roleFormFrom } from "@rah-os/client-core/role-form";
import RoleFieldEditor, { type RoleField } from "./RoleFieldEditor.tsx";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import type { RoleCreateRequest } from "@rah-os/protocol";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
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
  const [field, setField] = useState<RoleField>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const edit = (next: RoleField, button: HTMLButtonElement) => {
    trigger.current = button;
    setField(next);
  };
  const cancel = () => {
    setField(undefined);
    onDirtyChange(false);
    requestAnimationFrame(() => trigger.current?.focus());
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
  const runtime = inventory?.runtimes.find(
    (r) => r.runtimeOfferId === form.runtimeOfferId,
  );
  const model = runtime?.modelBindingDescriptors.find(
    (b) => b.modelBindingId === form.modelBindingId,
  );
  const { formatShortDateTime } = useTimeFormatter();
  const facts: Array<{
    field: RoleField;
    label: string;
    value: React.ReactNode;
  }> = [
    {
      field: "displayName",
      label: "名称",
      value: role.configuration.displayName,
    },
    {
      field: "runtimeOfferId",
      label: "CLI",
      value: runtime?.displayName ?? (loading ? "读取中…" : "当前配置不可用"),
    },
    {
      field: "modelBindingId",
      label: "模型",
      value:
        (model?.displayName ?? model?.modelId ?? form.modelBindingId) ||
        "未指定",
    },
    {
      field: "reasoning",
      label: "推理强度",
      value: form.reasoning || "未指定",
    },
    {
      field: "instructions",
      label: "角色 Prompt",
      value: <span className="whitespace-pre-wrap">{form.instructions}</span>,
    },
  ];
  const editor = (current: RoleField) => (
    <RoleFieldEditor
      key={current}
      field={current}
      role={role}
      client={client}
      disabled={disabled}
      onSave={onSave}
      onCancel={cancel}
      onDirtyChange={onDirtyChange}
    />
  );
  return (
    <div data-testid="loom-role-profile" className="space-y-5 font-sans">
      <div className="flex items-start gap-4">
        <Tooltip content="更换头像">
          <button
            type="button"
            aria-label="更换头像"
            disabled={disabled || Boolean(field)}
            onClick={(e) => edit("avatarKey", e.currentTarget)}
            className="group/avatar-edit relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus"
          >
            <AvatarSlot
              context="profile-hero"
              type="agent"
              agentAvatarUrl={role.configuration.avatarKey}
            />
            <span
              data-avatar-edit-veil=""
              className="absolute inset-0 flex items-center justify-center rounded-sticker bg-layer-backdrop text-foreground-on-hud transition-opacity opacity-0 group-hover/avatar-edit:opacity-100 group-focus-visible/avatar-edit:opacity-100 peer-focus-visible/avatar-edit:opacity-100"
            >
              <Pencil size={20} />
            </span>
          </button>
        </Tooltip>
        <p className="text-footnote text-foreground-hint">
          修改保存为新的角色修订；已有实例保持原配置。
        </p>
      </div>
      {field === "avatarKey" && editor(field)}
      <DescriptionList direction="horizontal">
        {facts.map(({ field: current, label, value }) => (
          <DescriptionItem key={current}>
            <DescriptionTerm>
              <span className="truncate">{label}</span>
              <Tooltip content={`编辑${label}`}>
                <button
                  type="button"
                  aria-label={`编辑${label}`}
                  disabled={disabled || Boolean(field)}
                  onClick={(e) => edit(current, e.currentTarget)}
                  className="shrink-0 rounded-sticker text-foreground-muted transition-colors hover:bg-fill-pressed hover:text-foreground disabled:opacity-50"
                >
                  <Pencil size={14} />
                </button>
              </Tooltip>
            </DescriptionTerm>
            <DescriptionDetails>
              {field === current ? (
                <div className="w-full">{editor(current)}</div>
              ) : (
                value
              )}
            </DescriptionDetails>
          </DescriptionItem>
        ))}
        <DescriptionItem>
          <DescriptionTerm>创建时间</DescriptionTerm>
          <DescriptionDetails>
            {formatShortDateTime(role.createdAt)}
          </DescriptionDetails>
        </DescriptionItem>
      </DescriptionList>
    </div>
  );
}
