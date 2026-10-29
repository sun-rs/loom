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
  type RoleForm,
  type RuntimeChoice,
} from "@rah-os/client-core/role-form";
import {
  runtimeModelOptions,
  resolveRuntimeModel,
} from "./runtime-model-options";

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
  const models = runtime ? runtimeModelOptions(runtime) : [];
  const selectedModel = models.find((model) =>
    model.variants.some((b) => b.modelBindingId === form.modelBindingId),
  );
  const fastTier = binding?.serviceTiers?.includes("fast")
    ? "fast"
    : binding?.serviceTiers?.includes("priority")
      ? "priority"
      : undefined;
  const pairedFast = Boolean(selectedModel?.fastBindingIds?.length);
  const fastMode =
    Boolean(selectedModel?.fastBindingIds?.includes(form.modelBindingId)) ||
    form.serviceTier === "fast" ||
    form.serviceTier === "priority";
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
        required: Boolean(selectedModel?.reasoning.length),
        advanced: false,
        visibleWhen: [],
      },
      ...(pairedFast ||
      fastTier ||
      form.serviceTier === "fast" ||
      form.serviceTier === "priority"
        ? [
            {
              key: "fastMode",
              kind: "boolean" as const,
              label: "快速模式",
              hint: pairedFast
                ? "K3.1 Pro Highspeed：能力相同，速度更快，约消耗两倍额度。"
                : "以更高的单 token 成本换取更快的速度启动此运行时。",
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
        models.map((b) => [
          b.value,
          b.reasoning.map((value) => ({ value, label: value })),
        ]),
      ),
      defaultValueByValue: Object.fromEntries(
        models.map((b) => [b.value, b.reasoning[0] ?? ""]),
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
      options: models.map((b) => ({
        value: b.value,
        label: b.label,
        supportedReasoningEfforts: b.reasoning,
        defaultReasoningEffort: b.reasoning[0],
      })),
    },
  };
  const values = {
    runtime: form.runtimeOfferId,
    model: selectedModel?.value ?? form.modelBindingId,
    effort: form.reasoning,
    environment: form.environment ?? {},
    fastMode,
  };
  const change = (key: string, value: RuntimeFormV2Value) => {
    const next = applyRuntimeFormV2Change(schema, sources, values, key, value);
    const resolved = resolveRuntimeModel(
      models,
      String(next.model ?? ""),
      String(next.effort ?? ""),
      key === "model" ? false : next.fastMode === true,
    );
    if (
      (key === "model" ||
        key === "effort" ||
        (key === "fastMode" && pairedFast)) &&
      !resolved
    )
      return;
    onChange({
      ...form,
      serviceTier:
        pairedFast || key === "runtime" || key === "model"
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
      modelBindingId:
        key === "runtime"
          ? ""
          : (resolved?.modelBindingId ?? form.modelBindingId),
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
          fields: schema.fields.filter(
            (field) =>
              field.key !== "runtime" &&
              (field.key !== "effort" ||
                (selectedModel?.reasoning.length ?? 0) > 1),
          ),
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
