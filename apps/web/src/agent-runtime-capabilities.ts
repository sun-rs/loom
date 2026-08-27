import type {
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
} from "@rah-os/protocol";

const EXPLICIT_REASONING_LEVELS = ["low", "medium", "high", "max"] as const;

export function supportedReasoningLevels(
  runtime: LocalRuntimeInventoryEntry | undefined,
  modelBindingId = "runtime_default",
): ReasoningLevel[] {
  const supported = new Set<ReasoningLevel>(["default"]);
  const descriptor = verifiedModelBindings(runtime).find(
    (candidate) => candidate.modelBindingId === modelBindingId,
  );
  if (descriptor !== undefined) {
    for (const reasoning of descriptor.supportedReasoning) {
      supported.add(reasoning);
    }
  }
  return [
    "default",
    ...EXPLICIT_REASONING_LEVELS.filter((reasoning) =>
      supported.has(reasoning),
    ),
  ];
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
    { label: "Runtime 默认", modelBindingId: "runtime_default" },
    ...verifiedModelBindings(runtime).map((binding) => ({
      label: `${binding.provider} / ${binding.modelId}`,
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
    : "runtime_default";
}

function verifiedModelBindings(
  runtime: LocalRuntimeInventoryEntry | undefined,
): LocalRuntimeInventoryEntry["modelBindingDescriptors"] {
  return (runtime?.modelBindingDescriptors ?? []).filter(
    (descriptor) => descriptor.evidence !== "declared",
  );
}
