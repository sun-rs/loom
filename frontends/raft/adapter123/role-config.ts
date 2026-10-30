import { resolveNativeRuntimeModel } from "./runtime-models.ts";
import {
  RoleConfigurationSchema,
  type RoleTemplate,
  type LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
/** Only verified identifiers become execution configuration. Remarks never become a prompt. */
export function nativeRoleConfiguration(
  input: any,
  inventory: LocalRuntimeInventoryResponse,
  base?: RoleTemplate["configuration"],
) {
  const name = (
    input.name ??
    input.displayName ??
    base?.displayName ??
    ""
  ).trim();
  const config: any = {
    ...base,
    displayName: name,
    handle: (input.name ?? input.displayName) ? name : (base?.handle ?? name),
    role: base?.role ?? name,
    instructions: input.loomPrompt ?? base?.instructions ?? "",
  };
  if (base?.role === base?.displayName) config.role = name;
  if (Object.hasOwn(input, "description"))
    config.description = input.description ?? "";
  if (Object.hasOwn(input, "avatarUrl"))
    config.avatarKey = input.avatarUrl ?? undefined;
  if (Object.hasOwn(input, "envVars")) config.environment = input.envVars ?? {};
  const changeRuntime =
    !base ||
    ["runtime", "model", "runtimeConfig", "reasoningEffort"].some((k) =>
      Object.hasOwn(input, k),
    );
  if (changeRuntime) {
    if (input.machineId && input.machineId !== inventory.hostId)
      throw Error("所选计算机没有已验证的运行时目录");
    const runtimeId = input.runtime === "antigravity" ? "agy" : input.runtime;
    const candidates = inventory.runtimes.filter(
      (r) =>
        r.available &&
        r.runtimeOfferId &&
        (runtimeId
          ? r.cliId === runtimeId
          : r.runtimeOfferId === base?.runtimeOfferId),
    );
    const offer =
      candidates.find((r) => r.runtimeOfferId === base?.runtimeOfferId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!offer?.runtimeOfferId) throw Error("请选择此计算机已发布的运行时");
    const runtimeConfig = input.runtimeConfig;
    if (runtimeConfig?.provider && runtimeConfig.provider.kind !== "default")
      throw Error("请在原生 CLI 配置账户；Loom 不修改 Provider 凭据");
    const model =
      runtimeConfig?.model?.id ?? runtimeConfig?.model?.name ?? input.model;
    const matches = offer.modelBindingDescriptors.filter((b) =>
      model
        ? b.modelId === model || b.modelBindingId === model
        : base?.modelIntent.exactBindingIds?.includes(b.modelBindingId),
    );
    const requestedEffort =
      runtimeConfig?.reasoningEffort ??
      input.reasoningEffort ??
      base?.modelIntent.reasoning ??
      matches[0]?.defaultReasoning ??
      "";
    const fast = runtimeConfig?.mode?.kind === "fast";
    const resolved = model
      ? resolveNativeRuntimeModel(
          inventory,
          offer.cliId!,
          model,
          requestedEffort,
          fast,
        )
      : undefined;
    const binding =
      offer.modelBindingDescriptors.find(
        (b) => b.modelBindingId === resolved?.modelBindingId,
      ) ?? (matches.length === 1 ? matches[0] : undefined);
    if (!binding)
      throw Error("请选择 Host 精确发布的模型；不会使用静态建议代替");
    const effort = requestedEffort || binding.defaultReasoning;
    if (effort && !binding.supportedReasoning.includes(effort as any))
      throw Error("所选模型不支持此推理强度");
    const nativePair =
      fast &&
      resolved?.modelBindingId === binding.modelBindingId &&
      binding.modelId === "kimi-code/k3.1-pro-highspeed";
    const tier = nativePair
      ? "default"
      : fast
        ? binding.supportedServiceTiers.includes("priority")
          ? "priority"
          : binding.supportedServiceTiers.includes("fast")
            ? "fast"
            : undefined
        : "default";
    if (!tier) throw Error("所选模型未发布快速模式");
    config.runtimeOfferId = offer.runtimeOfferId;
    config.modelIntent = {
      exactBindingIds: [binding.modelBindingId],
      fallback: "disabled",
      ...(effort ? { reasoning: effort } : {}),
      serviceTier: tier,
    };
    if (runtimeConfig?.envVars !== undefined)
      config.environment = runtimeConfig.envVars ?? {};
  }
  return RoleConfigurationSchema.parse(config);
}
