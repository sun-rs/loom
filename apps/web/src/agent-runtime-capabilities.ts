import type {
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
  ToolAccessMode,
} from "@rah-os/protocol";

export interface RuntimeReasoningOption {
  label: string;
  value: ReasoningLevel;
}

export const DEFAULT_TOOL_ACCESS_MODE =
  "full_access" as const satisfies ToolAccessMode;

export function runtimeReasoningOptions(
  runtime: LocalRuntimeInventoryEntry | undefined,
  modelBindingId = "runtime_default",
): RuntimeReasoningOption[] {
  const descriptor = verifiedModelBindings(runtime).find(
    (candidate) => candidate.modelBindingId === modelBindingId,
  );
  if (descriptor === undefined) {
    return [{ label: "Runtime 默认", value: "default" }];
  }
  const observedLabels = new Map(
    (descriptor.reasoningOptions ?? []).map((option) => [
      option.value,
      option.label,
    ]),
  );
  return [
    { label: "Runtime 默认", value: "default" },
    ...descriptor.supportedReasoning.map((value) => ({
      label: observedLabels.get(value) ?? fallbackReasoningLabel(value),
      value,
    })),
  ];
}

export function supportedReasoningLevels(
  runtime: LocalRuntimeInventoryEntry | undefined,
  modelBindingId = "runtime_default",
): ReasoningLevel[] {
  return runtimeReasoningOptions(runtime, modelBindingId).map(
    (option) => option.value,
  );
}

export function normalizeReasoningLevel(
  reasoning: ReasoningLevel,
  runtime: LocalRuntimeInventoryEntry | undefined,
  modelBindingId = "runtime_default",
): ReasoningLevel {
  return supportedReasoningLevels(runtime, modelBindingId).includes(reasoning)
    ? reasoning
    : "default";
}

export function runtimeModelOptions(
  runtime: LocalRuntimeInventoryEntry | undefined,
): Array<{ label: string; modelBindingId: string }> {
  return [
    ...verifiedModelBindings(runtime).map((binding) => ({
      label: binding.displayName ?? `${binding.provider} / ${binding.modelId}`,
      modelBindingId: binding.modelBindingId,
    })),
  ];
}

export function normalizeModelBindingId(
  modelBindingId: string | undefined,
  runtime: LocalRuntimeInventoryEntry | undefined,
): string {
  return runtimeModelOptions(runtime).some(
    (option) => option.modelBindingId === modelBindingId,
  )
    ? modelBindingId!
    : "";
}

/**
 * An older inventory row did not publish this capability. Treating it as
 * full-access only preserves replay compatibility without inventing a
 * restricted sandbox.
 */
export function runtimeToolAccessModes(
  runtime: LocalRuntimeInventoryEntry | undefined,
): ToolAccessMode[] {
  const supported = new Set(
    runtime?.supportedToolAccessModes ?? [DEFAULT_TOOL_ACCESS_MODE],
  );
  return supported.has(DEFAULT_TOOL_ACCESS_MODE)
    ? [DEFAULT_TOOL_ACCESS_MODE]
    : [];
}

function verifiedModelBindings(
  runtime: LocalRuntimeInventoryEntry | undefined,
): LocalRuntimeInventoryEntry["modelBindingDescriptors"] {
  return (runtime?.modelBindingDescriptors ?? []).filter(
    (descriptor) => descriptor.evidence !== "declared",
  );
}

function fallbackReasoningLabel(reasoning: string): string {
  if (reasoning === "xhigh") return "Extra high";
  return reasoning.slice(0, 1).toUpperCase() + reasoning.slice(1);
}
