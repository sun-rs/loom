import type {
  LocalRuntimeInventoryEntry,
  ReasoningLevel,
} from "@rah-os/protocol";

const EXPLICIT_REASONING_LEVELS = ["low", "medium", "high", "max"] as const;

export function supportedReasoningLevels(
  runtime: LocalRuntimeInventoryEntry | undefined,
): ReasoningLevel[] {
  const supported = new Set<ReasoningLevel>(["default"]);
  for (const descriptor of runtime?.modelBindingDescriptors ?? []) {
    if (descriptor.evidence === "declared") continue;
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
): ReasoningLevel {
  return supportedReasoningLevels(runtime).includes(reasoning)
    ? reasoning
    : "default";
}
