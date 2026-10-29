import type { RefObject } from "react";
import {
  RuntimeFormV2Fields,
  RuntimeSelectControl,
  Field,
  type RuntimeOption,
} from "../packages/web/src/components/agent/RuntimeConfigFields.tsx";
import {
  applyRuntimeFormV2Change,
  type ParsedRuntimeFormV2,
  type RuntimeFormV2Sources,
  type RuntimeFormV2Value,
} from "@botiverse/raft-runtime-form";
import {
  roleModelLabel,
  type RoleForm,
  type RuntimeChoice,
} from "@rah-os/client-core/role-form";

// Presentation/state transitions are upstream. This module only translates the
// Host's published capability catalog into that renderer's data contract.
export default function RoleRuntimeFields({
  form,
  choices,
  onChange,
  portalContainer,
  hideRuntime = false,
  pickerOptions,
}: {
  pickerOptions?: RuntimeOption[];
  form: RoleForm;
  choices: RuntimeChoice[];
  onChange: (next: RoleForm) => void;
  portalContainer?: RefObject<HTMLElement | null>;
  hideRuntime?: boolean;
}) {
  const runtime = choices.find((r) => r.runtimeOfferId === form.runtimeOfferId);
  const binding = runtime?.bindings.find(
    (b) => b.modelBindingId === form.modelBindingId,
  );
  const fastTier = binding?.serviceTiers?.includes("fast")
    ? "fast"
    : binding?.serviceTiers?.includes("priority")
      ? "priority"
      : undefined;
  const schema: ParsedRuntimeFormV2 = {
    runtimeId: form.runtimeOfferId,
    schemaVersion: "loom-published-capabilities-v1",
    blockingFieldKeys: [],
    requiredClientCapabilities: [],
    optionSources: {},
    fields: [
      ...(!hideRuntime
        ? [
            {
              key: "runtime",
              kind: "select" as const,
              label: "运行时",
              optionSourceId: "runtime",
              required: true,
              advanced: false,
              visibleWhen: [],
            },
          ]
        : []),
      {
        key: "model",
        kind: "select",
        label: "模型",
        optionSourceId: "model",
        required: true,
        advanced: false,
        visibleWhen: [],
      },
      {
        key: "effort",
        kind: "dependent_select",
        label: "推理强度",
        dependsOn: "model",
        optionSourceId: "effort",
        required: Boolean(
          runtime?.bindings.find(
            (b) => b.modelBindingId === form.modelBindingId,
          )?.reasoning.length,
        ),
        advanced: false,
        visibleWhen: [],
      },
      ...(fastTier ||
      form.serviceTier === "fast" ||
      form.serviceTier === "priority"
        ? [
            {
              key: "fastMode",
              kind: "boolean" as const,
              label: "快速模式",
              hint: "以更高的单 token 成本换取更快的速度启动此运行时。",
              required: false,
              advanced: false,
              visibleWhen: [],
            },
          ]
        : []),
      {
        key: "environment",
        kind: "string_map",
        label: "环境变量",
        required: false,
        advanced: true,
        visibleWhen: [],
      },
    ],
  };
  const sources: RuntimeFormV2Sources = {
    effort: {
      sourceId: "effort",
      kind: "dependent_select",
      pointer: "/effort",
      dependsOn: "model",
      optionsByValue: Object.fromEntries(
        (runtime?.bindings ?? []).map((b) => [
          b.modelBindingId,
          b.reasoning.map((value) => ({ value, label: value })),
        ]),
      ),
      defaultValueByValue: Object.fromEntries(
        (runtime?.bindings ?? []).map((b) => [
          b.modelBindingId,
          b.reasoning[0] ?? "",
        ]),
      ),
    },
    runtime: {
      sourceId: "runtime",
      kind: "select",
      pointer: "/runtime",
      options: choices.map((r) => ({
        value: r.runtimeOfferId,
        label: r.label.split("（")[0]!,
      })),
    },
    model: {
      sourceId: "model",
      kind: "select",
      pointer: "/model",
      options: (runtime?.bindings ?? []).map((b) => ({
        value: b.modelBindingId,
        label: roleModelLabel(b, runtime?.bindings ?? []),
        supportedReasoningEfforts: b.reasoning,
        defaultReasoningEffort: b.reasoning[0],
      })),
    },
  };
  const values = {
    runtime: form.runtimeOfferId,
    model: form.modelBindingId,
    effort: form.reasoning,
    environment: form.environment ?? {},
    fastMode: form.serviceTier === "fast" || form.serviceTier === "priority",
  };
  const change = (key: string, value: RuntimeFormV2Value) => {
    const next = applyRuntimeFormV2Change(schema, sources, values, key, value);
    onChange({
      ...form,
      serviceTier:
        key === "runtime" || key === "model"
          ? "default"
          : key === "fastMode"
            ? value === true
              ? (fastTier ?? form.serviceTier ?? "default")
              : "default"
            : (form.serviceTier ?? "default"),
      environment:
        typeof next.environment === "object" && next.environment !== null
          ? next.environment
          : {},
      runtimeOfferId: String(next.runtime ?? form.runtimeOfferId),
      modelBindingId: key === "runtime" ? "" : String(next.model ?? ""),
      reasoning: key === "runtime" ? "" : String(next.effort ?? ""),
    });
  };
  return (
    <>
      {!hideRuntime && (
        <Field label="运行时" required>
          <RuntimeSelectControl
            placeholder="选择运行时"
            value={form.runtimeOfferId}
            options={
              pickerOptions ??
              choices.map((r) => ({
                value: r.runtimeOfferId,
                label: r.label.split("（")[0]!,
              }))
            }
            onValueChange={(value) => change("runtime", value)}
            portalContainer={portalContainer}
            testId="runtime-form-v2-runtime"
          />
        </Field>
      )}
      <RuntimeFormV2Fields
        form={{
          ...schema,
          fields: schema.fields.filter((field) => field.key !== "runtime"),
        }}
        sources={sources}
        values={values}
        showValidationErrors={false}
        portalContainer={portalContainer}
        onChange={change}
      />
    </>
  );
}
