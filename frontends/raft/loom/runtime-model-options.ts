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
  /** A verified native model pair, not a provider service-tier parameter. */
  fastBindingIds?: string[];
};
/** UI grouping only. Role revisions and launch still use exact Host binding IDs.
 * AGY publishes each effort as a native model ID; unknown/inconsistent metadata
 * stays separate. Never strip a suffix from an executable binding or saved Role. */
export function runtimeModelOptions(
  runtime: RuntimeChoice,
): RuntimeModelOption[] {
  const result = new Map<string, RuntimeModelOption>();
  // Explicit official K3.1 Pro pair only. K2.8/K2.7 highspeed are different models.
  const normal = runtime.bindings.find(
    (b) => b.modelId === "kimi-code/k3.1-pro",
  );
  const fast = runtime.bindings.find(
    (b) => b.modelId === "kimi-code/k3.1-pro-highspeed",
  );
  const kimiPair =
    runtime.cliId === "kimi" &&
    normal &&
    fast &&
    normal.serviceTiers?.includes("default") &&
    fast.serviceTiers?.includes("default") &&
    normal.reasoning.length === fast.reasoning.length &&
    normal.reasoning.every((level) => fast.reasoning.includes(level));
  for (const binding of runtime.bindings) {
    const paired = kimiPair && (binding === normal || binding === fast);
    const suffix =
      runtime.cliId === "agy" &&
      binding.modelId?.match(/-(low|medium|high|xhigh|max)$/);
    const grouped =
      suffix &&
      binding.reasoning.length === 1 &&
      binding.reasoning[0] === suffix[1];
    const key = paired
      ? "kimi-native-pair:k3.1-pro"
      : grouped
        ? "model-group:" + binding.modelId!.slice(0, -suffix[0].length)
        : binding.modelBindingId;
    const label = roleModelLabel(paired ? normal! : binding, runtime.bindings);
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
        ...(paired ? { fastBindingIds: [fast!.modelBindingId] } : {}),
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
  fast = false,
) {
  const group = groups.find((group) => group.value === value);
  return group?.variants.find(
    (binding) =>
      (!group.fastBindingIds ||
        group.fastBindingIds.includes(binding.modelBindingId) === fast) &&
      (binding.reasoning.length ? binding.reasoning.includes(effort) : !effort),
  );
}
