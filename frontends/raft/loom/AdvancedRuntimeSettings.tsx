// Local data wiring composed from official FormField/Input/Switch primitives.
import { Input, Switch } from "raft-ui";
import type { RuntimeSettings } from "@rah-os/protocol";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import {
  SETTINGS_SCOPE_NOTES,
  type SettingsForm,
} from "./runtime-settings-form.ts";
export default function AdvancedRuntimeSettings({
  open,
  onOpenChange,
  base,
  form,
  disabled,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: RuntimeSettings;
  form: SettingsForm;
  disabled: boolean;
  onChange: (next: SettingsForm) => void;
}) {
  const fields = [
    ["maxConcurrentStarts", "同时启动上限", 1, 64],
    ["minStartIntervalMs", "启动最小间隔（毫秒）", 0, 60000],
    ["wakeChainLimit", "实例互相唤醒上限", 1, 1000],
    ["prewarmRecentHours", "服务启动时预热近期实例（小时）", 0, 720],
  ] as const;
  const watchdog = [
    ["noProgressWarnMinutes", "无进展告警（分钟）", 1440],
    ["queuedStallTerminateMinutes", "排队无进展终止（分钟）", 1440],
    ["maxRunMinutes", "单次运行上限（分钟）", 10080],
  ] as const;
  const numberField = (
    key: Exclude<keyof SettingsForm, "runtimes">,
    label: string,
    min: number,
    max: number,
    step: number | string = 1,
  ) => (
    <FormField key={key} label={label} labelStyle="plain" size="compact">
      <Input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={form[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...form, [key]: e.target.value })}
        className="w-full text-sm"
      />
    </FormField>
  );
  return (
    <details
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      data-testid="advanced-runtime-settings"
      className="text-sm"
    >
      <summary className="cursor-pointer font-bold">高级设置</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-foreground-muted">
          {SETTINGS_SCOPE_NOTES.future}
        </p>
        {fields.map(([key, label, min, max]) =>
          numberField(key, label, min, max),
        )}
        {base.runtimes.map((runtime) => (
          <FormField
            key={runtime.runtimeProfileId}
            label={runtime.runtimeProfileId + " 并发上限"}
            labelStyle="plain"
            size="compact"
          >
            <Input
              aria-label={runtime.runtimeProfileId + " 并发上限"}
              type="number"
              min={1}
              max={64}
              step={1}
              value={form.runtimes[runtime.runtimeProfileId] ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...form,
                  runtimes: {
                    ...form.runtimes,
                    [runtime.runtimeProfileId]: e.target.value,
                  },
                })
              }
              className="w-full text-sm"
            />
            <p className="text-xs text-foreground-muted">
              供给上限 {runtime.offerMaxConcurrent}
            </p>
          </FormField>
        ))}
        <FormField label="创建实例时预热" labelStyle="plain" size="compact">
          <Switch
            aria-label="创建实例时预热"
            checked={form.prewarmEnabled === "1"}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({ ...form, prewarmEnabled: checked ? "1" : "0" })
            }
          />
        </FormField>
        <p className="text-xs leading-5 text-foreground-muted">
          预热默认关闭。开启后会启动 CLI
          运行时；服务启动时仅预热指定小时内活跃的实例，0 表示不预热。
        </p>
        <p className="text-xs leading-5 text-foreground-muted">
          {SETTINGS_SCOPE_NOTES.immediate}
        </p>
        {watchdog.map(([key, label, max]) =>
          numberField(key, label, 1, max, "any"),
        )}
      </div>
    </details>
  );
}
