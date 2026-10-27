import {
  RuntimeModelBindingSchema,
  type RuntimeModelBinding,
} from "@rah-os/protocol";
/** Native `agy models` publishes exact IDs, with effort embedded in each ID.
 * A new/unknown effort is not turned into a made-up selectable level. */
export function parseAgyModelCatalog(text: string): RuntimeModelBinding[] {
  if (Buffer.byteLength(text) > 4 * 1024 * 1024) return [];
  const result: RuntimeModelBinding[] = [];
  const seen = new Set<string>();
  for (const line of text.trim().split("\n")) {
    const [id, label, extra] = line.trim().split("\t");
    if (
      !id ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(id) ||
      !label ||
      extra ||
      seen.has(id)
    )
      return [];
    seen.add(id);
    const effort = /-(low|medium|high|xhigh|max)$/.exec(id)?.[1];
    const parsed = RuntimeModelBindingSchema.safeParse({
      modelBindingId: `local:agy-cli/v1:${id}`,
      modelId: id,
      provider: "antigravity",
      displayName: label,
      evidence: "probed",
      capabilityClasses: ["deep_coding"],
      supportedReasoning: effort ? [effort] : [],
      ...(effort ? { defaultReasoning: effort } : {}),
      supportedServiceTiers: ["default"],
      adapterMapping: {
        kind: "generic-process-argv/v1",
        config: {
          modelArguments: ["--model", id],
          reasoningArguments: ["--effort", "{reasoning}"],
        },
      },
    });
    if (!parsed.success || result.length >= 512) return [];
    result.push(parsed.data);
  }
  return result;
}
