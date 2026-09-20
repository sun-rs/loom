import {
  CustomModelSchema,
  ModelIntentSchema,
  type ModelIntent,
} from "@rah-os/protocol";

export function customModelDraft(runtime: string, modelId: string) {
  return `custom:${runtime}:${modelId}`;
}
export function parseCustomModelDraft(value: string) {
  const match = /^custom:(claude|codex):(.+)$/u.exec(value);
  if (!match) return undefined;
  const result = CustomModelSchema.safeParse({
    runtime: match[1],
    modelId: match[2],
  });
  return result.success ? result.data : undefined;
}
export function modelIntentDraft(intent: Partial<ModelIntent>) {
  return intent.customModel
    ? customModelDraft(intent.customModel.runtime, intent.customModel.modelId)
    : (intent.exactBindingIds?.[0] ?? "");
}
export function selectedModelIntent(
  value: string,
  reasoning: ModelIntent["reasoning"] = "default",
): ModelIntent {
  const customModel = parseCustomModelDraft(value);
  return customModel
    ? ModelIntentSchema.parse({ customModel, fallback: "disabled", reasoning })
    : {
        fallback: "disabled",
        reasoning,
        ...(value === "runtime_default" ? {} : { exactBindingIds: [value] }),
      };
}

// Raft Computer 1.0.32 RUNTIME_MODELS.claude (main.js:20241).
// Suggestions, not CLI-probed availability. Each selects an explicit native ID.
export const claudeModelSuggestions = [
  ["opus", "Claude Opus"],
  ["fable", "Claude Fable"],
  ["sonnet", "Claude Sonnet"],
  ["haiku", "Claude Haiku"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-opus-4-8", "Claude Opus 4.8"],
  ["claude-opus-4-7", "Claude Opus 4.7"],
  ["claude-opus-4-6", "Claude Opus 4.6"],
  ["claude-fable-5-1", "Claude Fable 5.1"],
  ["claude-fable-5", "Claude Fable 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
] as const;
