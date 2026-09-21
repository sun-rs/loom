import { chatModelIdentifier } from "./chat-model-identifier.ts";
import { claudeModelSuggestions } from "./runtime-model-selection.ts";

/** Presentation only. Never pass these labels into configuration or dispatch.
 * Catalog names win; missing historical catalogs use the same bounded parser.
 */
export function modelDisplayName(
  model: {
    modelId: string;
    provider?: string;
    displayName?: string | undefined;
  },
  cliId?: string,
): string {
  const id = chatModelIdentifier(model);
  const slash = id.indexOf("/");
  const provider =
    model.provider?.trim() || (slash > 0 ? id.slice(0, slash) : undefined);
  const short =
    provider && id.startsWith(`${provider}/`)
      ? id.slice(provider.length + 1)
      : id;
  const claude = claudeModelSuggestions.find(([key]) => key === id)?.[1];
  const name = model.displayName?.trim() || claude || friendlyModelId(short);
  const qualified =
    cliId === "opencode" ||
    (slash > 0 &&
      !model.displayName?.trim() &&
      cliId !== "codex" &&
      cliId !== "claude");
  return qualified && provider
    ? `${friendlyModelId(provider)} · ${name}`
    : name;
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
