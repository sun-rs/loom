import { DialogCommit } from "raft-ui/wip";
import { uiActionProps } from "./ui-action-props.ts";
import { useDraftNavigation } from "./DraftNavigation.tsx";
import RoleRuntimeFields from "./RoleRuntimeFields.tsx";
import { Dices } from "lucide-react";
import StableField from "../packages/web/src/components/agent/StableField.tsx";
import { suggestAgentName } from "./role-suggested-name.ts";
import { useEffect, useState, useId, type ReactNode } from "react";
import { DialogFooter, Button, Input, Textarea, Spinner } from "raft-ui";
import {
  roleFormFrom,
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
  creation = false,
  takenNames = [],
  beforeSubmit,
  submitDisabled = false,
}: {
  client: RahClient;
  creation?: boolean;
  submitDisabled?: boolean;
  takenNames?: string[];
  beforeSubmit?: ReactNode;
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
  const [computerName, setComputerName] = useState("");
  const [choices, setChoices] = useState<RuntimeChoice[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void client
      .request("host.runtime.list", {})
      .then((result) => {
        if (alive) {
          setChoices(runtimeChoices(result));
          setComputerName(result.computer?.displayName ?? result.hostId);
        }
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
  const formId = useId();
  const Field = creation ? StableField : FormField;
  return (
    <form
      id={formId}
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || submitDisabled || !choices) return;
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
                  environment: result.value.environment,
                }
              : result.value,
          );
        else setError(result.error);
      }}
    >
      <fieldset disabled={disabled} className="space-y-1">
        {creation && computerName && (
          <SelectField
            stable
            label="计算机（能力来源）"
            value="local"
            options={[{ value: "local", label: computerName }]}
            onChange={() => {}}
            disabled
          />
        )}
        <div
          hidden={Boolean(field)}
          className={creation ? "space-y-1" : undefined}
        >
          <Field
            label="名称"
            required
            className={creation ? undefined : "mb-3"}
            labelAccessory={
              creation ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="随机名称"
                  onClick={() =>
                    setForm({
                      ...form,
                      displayName: suggestAgentName([
                        ...takenNames,
                        form.displayName,
                      ]),
                    })
                  }
                >
                  <Dices size={12} />
                </Button>
              ) : undefined
            }
          >
            <Input
              aria-label="名称"
              required
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
            />
          </Field>
          <Field label="角色 Prompt" className={creation ? undefined : "mb-3"}>
            <Textarea
              aria-label="角色 Prompt"
              required
              rows={creation ? 3 : 5}
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
            />
          </Field>
        </div>
        {!choices && !error ? (
          <Spinner aria-label="读取 CLI 目录" />
        ) : (
          <RoleRuntimeFields
            form={form}
            choices={choices ?? []}
            onChange={setForm}
            portalContainer={portalContainer}
            hideRuntime={Boolean(field && field !== "runtimeOfferId")}
          />
        )}
        {role && (
          <p className="mb-3 text-sm">
            保存为新修订。已有实例保持原配置，可在重启时选择更新。
          </p>
        )}
        {beforeSubmit}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
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
            <DialogCommit
              form={formId}
              variant="accent"
              size="lg"
              type="submit"
              disabled={
                disabled ||
                submitDisabled ||
                !choices ||
                !binding ||
                (Boolean(role) && !dirty)
              }
            >
              保存运行时配置
            </DialogCommit>
          ) : (
            <DialogCommit
              form={formId}
              {...(creation
                ? { variant: "accent" as const, size: "lg" as const }
                : uiActionProps.formSave)}
              type="submit"
              disabled={
                disabled ||
                submitDisabled ||
                !choices ||
                !binding ||
                (Boolean(role) && !dirty)
              }
            >
              保存角色
            </DialogCommit>
          )}
        </DialogFooter>
      </fieldset>
    </form>
  );
}
