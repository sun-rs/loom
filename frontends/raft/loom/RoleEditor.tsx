import { uiActionProps } from "./ui-action-props.ts";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import { useEffect, useState } from "react";
import { Button, Input, Textarea, Spinner } from "raft-ui";
import {
  roleFormFrom,
  roleModelLabel,
  buildRoleConfiguration,
  runtimeChoices,
  type RoleForm,
  type RuntimeChoice,
} from "@rah-os/client-core/role-form";
import type { RoleTemplate, RoleCreateRequest } from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { SelectField } from "./ManagementUi.tsx";
export default function RoleEditor({
  client,
  role,
  field,
  disabled,
  onSave,
  onDirtyChange,
  onNavigationDiscard,
  onCancel,
  portalContainer,
}: {
  client: RahClient;
  field?: "runtimeOfferId" | "modelBindingId";
  role?: RoleTemplate;
  disabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onNavigationDiscard?: () => void;
  onCancel?: () => void;
  portalContainer?: React.RefObject<HTMLElement | null>;
  onSave: (config: RoleCreateRequest["configuration"]) => void;
}) {
  const [form, setForm] = useState<RoleForm>(() =>
    role
      ? roleFormFrom(role.configuration)
      : {
          displayName: "",
          handle: `role-${crypto.randomUUID()}`,
          instructions: "",
          modelBindingId: "",
          reasoning: "",
          role: "",
          runtimeOfferId: "",
        },
  );
  const [initial] = useState(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useDraftNavigation(dirty, () => {
    setForm(initial);
    onNavigationDiscard?.();
  });
  const [choices, setChoices] = useState<RuntimeChoice[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void client
      .request("host.runtime.list", {})
      .then((result) => {
        if (alive) setChoices(runtimeChoices(result));
      })
      .catch(() => {
        if (alive) setError("无法读取 CLI 目录，请关闭后重试。");
      });
    return () => {
      alive = false;
    };
  }, [client]);
  const runtime = choices?.find(
    (r) => r.runtimeOfferId === form.runtimeOfferId,
  );
  const binding = runtime?.bindings.find(
    (b) => b.modelBindingId === form.modelBindingId,
  );
  return (
    <form
      className={field ? "space-y-4" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || !choices) return;
        const result = buildRoleConfiguration(
          form,
          choices,
          role?.configuration,
        );
        if (result.ok)
          onSave(
            field && role
              ? {
                  ...role.configuration,
                  runtimeOfferId: result.value.runtimeOfferId,
                  modelIntent: result.value.modelIntent,
                }
              : result.value,
          );
        else setError(result.error);
      }}
    >
      <fieldset disabled={disabled} className={field ? "space-y-4" : undefined}>
        <div hidden={Boolean(field)}>
          <FormField label="名称" className="mb-3">
            <Input
              aria-label="名称"
              required
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
            />
          </FormField>
          <FormField label="角色 Prompt" className="mb-3">
            <Textarea
              aria-label="角色 Prompt"
              required
              rows={5}
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
            />
          </FormField>
        </div>
        {!choices && !error ? (
          <Spinner aria-label="读取 CLI 目录" />
        ) : (
          <>
            <div hidden={Boolean(field && field !== "runtimeOfferId")}>
              <SelectField
                portalContainer={portalContainer}
                label={field ? "运行时" : "CLI"}
                value={form.runtimeOfferId}
                options={(choices ?? []).map((r) => ({
                  value: r.runtimeOfferId,
                  label: r.label.split("（")[0]!,
                }))}
                onChange={(value) =>
                  setForm({
                    ...form,
                    runtimeOfferId: value,
                    modelBindingId: "",
                    reasoning: "",
                  })
                }
              />
            </div>
            <div>
              <SelectField
                portalContainer={portalContainer}
                label="模型"
                value={form.modelBindingId}
                options={(runtime?.bindings ?? []).map((b) => ({
                  value: b.modelBindingId,
                  label: roleModelLabel(b, runtime?.bindings ?? []),
                }))}
                onChange={(value) =>
                  setForm({
                    ...form,
                    modelBindingId: value,
                    reasoning:
                      runtime?.bindings.find((b) => b.modelBindingId === value)
                        ?.reasoning[0] ?? "",
                  })
                }
              />
            </div>
            <SelectField
              portalContainer={portalContainer}
              label="推理强度"
              value={form.reasoning}
              options={(binding?.reasoning ?? []).map((value) => ({
                value,
                label: value,
              }))}
              disabled={!binding?.reasoning.length}
              onChange={(value) => setForm({ ...form, reasoning: value })}
            />
          </>
        )}
        {role && (
          <p className="mb-3 text-sm">
            保存为新修订。已有实例保持原配置，可在重启时选择更新。
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={disabled}
              onClick={onCancel}
            >
              取消
            </Button>
          )}
          {field ? (
            <Button
              variant="accent"
              size="lg"
              type="submit"
              disabled={
                disabled || !choices || !binding || (Boolean(role) && !dirty)
              }
            >
              保存运行时配置
            </Button>
          ) : (
            <Button
              {...uiActionProps.formSave}
              type="submit"
              disabled={
                disabled || !choices || !binding || (Boolean(role) && !dirty)
              }
            >
              保存角色
            </Button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
