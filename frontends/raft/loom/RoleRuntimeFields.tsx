import type { RefObject } from "react";
import { RuntimeFormV2Fields } from "../packages/web/src/components/agent/RuntimeConfigFields.tsx";
import {
  applyRuntimeFormV2Change,
  type ParsedRuntimeFormV2,
  type RuntimeFormV2Sources,
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
}: {
  form: RoleForm;
  choices: RuntimeChoice[];
  onChange: (next: RoleForm) => void;
  portalContainer?: RefObject<HTMLElement | null>;
  hideRuntime?: boolean;
}) {
  const runtime = choices.find((r) => r.runtimeOfferId === form.runtimeOfferId);
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
  };
  return (
    <RuntimeFormV2Fields
      form={schema}
      sources={sources}
      values={values}
      showValidationErrors={false}
      portalContainer={portalContainer}
      onChange={(key, value) => {
        const next = applyRuntimeFormV2Change(
          schema,
          sources,
          values,
          key,
          value,
        );
        onChange({
          ...form,
          environment:
            typeof next.environment === "object" && next.environment !== null
              ? next.environment
              : {},
          runtimeOfferId: String(next.runtime ?? form.runtimeOfferId),
          modelBindingId: key === "runtime" ? "" : String(next.model ?? ""),
          reasoning: key === "runtime" ? "" : String(next.effort ?? ""),
        });
      }}
    />
  );
}
