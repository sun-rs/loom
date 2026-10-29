import {
  roleModelLabel,
  type BindingChoice,
  type RuntimeChoice,
} from "@rah-os/client-core/role-form";
export type RuntimeModelOption = {
  value: string;
  label: string;
  reasoning: string[];
  variants: BindingChoice[];
};
/** UI grouping only. Role revisions and launch still use exact Host binding IDs.
 * AGY publishes each effort as a native model ID; unknown/inconsistent metadata
 * stays separate. Never strip a suffix from an executable binding or saved Role. */
export function runtimeModelOptions(
  runtime: RuntimeChoice,
): RuntimeModelOption[] {
  const result = new Map<string, RuntimeModelOption>();
  for (const binding of runtime.bindings) {
    const suffix =
      runtime.cliId === "agy" &&
      binding.modelId?.match(/-(low|medium|high|xhigh|max)$/);
    const grouped =
      suffix &&
      binding.reasoning.length === 1 &&
      binding.reasoning[0] === suffix[1];
    const key = grouped
      ? "model-group:" + binding.modelId!.slice(0, -suffix[0].length)
      : binding.modelBindingId;
    const label = roleModelLabel(binding, runtime.bindings);
    const visibleLabel = grouped
      ? label.replace(/\s+\((?:low|medium|high|xhigh|max)\)$/i, "")
      : label;
    let group = result.get(key);
    if (!group) {
      group = {
        // Native searchable controls show value as secondary text when it
        // differs from label. Keep this transient selection human-readable;
        // resolveRuntimeModel maps it back before any Role write.
        value: visibleLabel,
        label: visibleLabel,
        reasoning: [],
        variants: [],
      };
      result.set(key, group);
    }
    group.variants.push(binding);
    for (const effort of binding.reasoning)
      if (!group.reasoning.includes(effort)) group.reasoning.push(effort);
  }
  const groups = [...result.values()];
  for (const group of groups)
    if (groups.filter((other) => other.label === group.label).length > 1) {
      group.value = `${group.label} · ${group.variants[0]!.modelId ?? group.variants[0]!.modelBindingId.replace(/^local:[^:]+:/, "")}`;
    }
  return groups.map((group) => ({ ...group, label: group.value }));
}
export function resolveRuntimeModel(
  groups: RuntimeModelOption[],
  value: string,
  effort: string,
) {
  return groups
    .find((group) => group.value === value)
    ?.variants.find((binding) =>
      binding.reasoning.length ? binding.reasoning.includes(effort) : !effort,
    );
}
