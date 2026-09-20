/** Explicit submission policy, NOT local probe or account availability evidence.
 * Claude Code model-config, effort table, checked 2026-09-21:
 * https://code.claude.com/docs/en/model-config#adjust-effort-level
 * Exact version IDs only: aliases/gateway IDs must use their probed binding.
 */
const five = ["low", "medium", "high", "xhigh", "max"] as const;
const four = ["low", "medium", "high", "max"] as const;
const documented: Readonly<Record<string, readonly string[]>> = {
  "claude-sonnet-5": five,
  "claude-sonnet-4-6": four,
  "claude-opus-5": five,
  "claude-opus-4-8": five,
  "claude-opus-4-7": five,
  "claude-opus-4-6": four,
  "claude-fable-5-1": five,
  "claude-fable-5": five,
};
export function customModelEffortLevels(model: {
  runtime: string;
  modelId: string;
}): readonly (typeof five)[number][] {
  return (
    model.runtime === "claude" && Object.hasOwn(documented, model.modelId)
      ? documented[model.modelId]!
      : []
  ) as readonly (typeof five)[number][];
}
export function customModelAllowsEffort(
  model: { runtime: string; modelId: string },
  effort?: string,
): boolean {
  return (
    effort === undefined ||
    effort === "default" ||
    customModelEffortLevels(model).some((level) => level === effort)
  );
}
