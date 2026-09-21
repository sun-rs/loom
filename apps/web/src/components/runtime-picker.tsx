import { useState } from "react";
import {
  customModelDraft,
  parseCustomModelDraft,
} from "../runtime-model-selection.ts";
import type { ReactNode } from "react";
import { DiscoveryFilter } from "./discovery-filter.tsx";

/** Shared field selection for Agent creation and runtime configuration. */
export function RuntimePicker({
  label,
  value,
  options,
  onChange,
  disabled,
  required = false,
  action,
  belowControl,
  customRuntime,
}: {
  label: string;
  value: string;
  options: {
    id: string;
    label: string;
    nativeId?: string;
    description?: string | undefined;
  }[];
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
  action?: ReactNode;
  belowControl?: ReactNode;
  customRuntime?: "claude" | "codex" | undefined;
}) {
  const custom = parseCustomModelDraft(value);
  const [customOpen, setCustomOpen] = useState(!!custom);
  const [customText, setCustomText] = useState(custom?.modelId ?? "");
  const selectedLabel =
    customRuntime && customOpen
      ? "自定义"
      : (options.find((item) => item.id === value)?.label ?? "请选择");
  return (
    <div className="rah-runtime-edit-field">
      <b>
        <span>
          {label}
          {required && <em> *</em>}
        </span>
        {action}
      </b>
      {customRuntime && customOpen && (
        <label className="rah-runtime-custom-model">
          <input
            aria-label="自定义模型 ID"
            placeholder="自定义模型 ID"
            value={customText}
            disabled={disabled}
            onChange={(event) => {
              const text = event.target.value;
              setCustomText(text);
              const draft = customModelDraft(customRuntime, text.trim());
              onChange(parseCustomModelDraft(draft) ? draft : "");
            }}
          />
        </label>
      )}
      <DiscoveryFilter
        label={label}
        triggerAriaLabel={`${label}：${selectedLabel}`}
        icon={null}
        values={[customRuntime && customOpen ? "__custom_model__" : value]}
        options={[
          ...options.map((option) => ({
            ...option,
            title: option.nativeId
              ? `${option.label} — ${option.nativeId}`
              : option.label,
            searchText: `${option.label} ${option.nativeId ?? ""}`,
          })),
          ...(customRuntime
            ? [{ id: "__custom_model__", label: "自定义" }]
            : []),
        ]}
        multiple={false}
        clearable={false}
        searchable={options.length > 10}
        variant="field"
        selected={false}
        showCount={false}
        disabled={disabled}
        className="rah-runtime-picker"
        triggerLabel={selectedLabel}
        onChange={(values) => {
          if (values[0] === "__custom_model__") {
            setCustomOpen(true);
            onChange("");
          } else if (values[0] !== undefined) {
            setCustomOpen(false);
            onChange(values[0]);
          }
        }}
      />
      {belowControl}
    </div>
  );
}
