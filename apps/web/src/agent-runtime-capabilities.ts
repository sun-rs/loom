import {
  claudeModelSuggestions,
  customModelDraft,
  parseCustomModelDraft,
} from "./runtime-model-selection.ts";
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
  selected = "",
): Array<{ label: string; modelBindingId: string; nativeId: string }> {
  const models = verifiedModelBindings(runtime)
    .filter(
      (binding) => runtime?.cliId !== "claude" || binding.modelId !== "default",
    )
    .map((binding) => ({
      label: runtimeModelLabel(runtime!, binding),
      modelBindingId: binding.modelBindingId,
      nativeId: binding.modelId,
    }));
  if (runtime?.customModelRuntime === "claude") {
    for (const [id, label] of claudeModelSuggestions) {
      const found = models.find((model) => model.nativeId === id);
      if (found) found.label = label;
      else
        models.push({
          label,
          nativeId: id,
          modelBindingId: customModelDraft("claude", id),
        });
    }
  }
  const custom = parseCustomModelDraft(selected);
  if (
    custom &&
    custom.runtime === runtime?.customModelRuntime &&
    !models.some((model) => model.modelBindingId === selected)
  )
    models.push({
      label: custom.modelId,
      nativeId: custom.modelId,
      modelBindingId: selected,
    });
  return models;
}

/** Provider identity comes from the discovered catalog, never a display-name split. */
export function runtimeModelLabel(
  runtime: Pick<LocalRuntimeInventoryEntry, "cliId" | "executable">,
  binding: LocalRuntimeInventoryEntry["modelBindingDescriptors"][number],
): string {
  const cliId =
    runtime.cliId ??
    runtime.executable
      .split(/[\\/]/u)
      .at(-1)
      ?.replace(/\.exe$/iu, "");
  const providerPrefix = `${binding.provider}/`;
  const modelId = binding.modelId.startsWith(providerPrefix)
    ? binding.modelId.slice(providerPrefix.length)
    : binding.modelId;
  return cliId === "opencode"
    ? `${friendlyModelToken(binding.provider)} · ${binding.displayName?.trim() || friendlyModelId(modelId)}`
    : (binding.displayName ?? binding.modelId);
}

export function normalizeModelBindingId(
  modelBindingId: string | undefined,
  runtime: LocalRuntimeInventoryEntry | undefined,
): string {
  return runtimeModelOptions(runtime, modelBindingId).some(
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

export function runtimeFastTier(
  runtime: LocalRuntimeInventoryEntry | undefined,
  bindingId: string,
): "priority" | "fast" | undefined {
  const tiers = verifiedModelBindings(runtime).find(
    (model) => model.modelBindingId === bindingId,
  )?.supportedServiceTiers;
  return tiers?.includes("priority")
    ? "priority"
    : tiers?.includes("fast")
      ? "fast"
      : undefined;
}

// Source-inspired Raft humanization fallback. Catalog display names always win;
// retain model separators/version punctuation instead of changing execution IDs.
function friendlyModelToken(token: string): string {
  const brands: Record<string, string> = {
    aihubmix: "Aihubmix",
    openai: "OpenAI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    gpt: "GPT",
    gemini: "Gemini",
    claude: "Claude",
    kimi: "Kimi",
    minimax: "MiniMax",
    glm: "GLM",
    api: "API",
    ai: "AI",
  };
  return (
    brands[token.toLowerCase()] ??
    token.replace(/^./u, (value) => value.toUpperCase())
  );
}
function friendlyModelId(id: string): string {
  return id
    .split(/([-_/])/u)
    .map((part) => (/^[-_/]$/u.test(part) ? part : friendlyModelToken(part)))
    .join("");
}
