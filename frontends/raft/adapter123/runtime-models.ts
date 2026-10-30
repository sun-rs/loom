import { runtimeChoices } from "@rah-os/client-core/role-form";
import type { LocalRuntimeInventoryResponse } from "@rah-os/protocol";
import {
  runtimeModelOptions,
  resolveRuntimeModel,
} from "../loom/runtime-model-options.ts";
export const nativeRuntimeId = (id: string) =>
  id === "agy" ? "antigravity" : id;
export const loomRuntimeId = (id: string) =>
  id === "antigravity" ? "agy" : id;
export function nativeRuntimeGroups(
  inventory: LocalRuntimeInventoryResponse,
  runtime: string,
) {
  const choices = runtimeChoices(inventory).filter(
    (r) => r.cliId === loomRuntimeId(runtime),
  );
  if (choices.length !== 1) throw Error("计算机未发布唯一可用运行时");
  return runtimeModelOptions(choices[0]!);
}
export function nativeRuntimeModels(
  inventory: LocalRuntimeInventoryResponse,
  hostId: string,
  runtime: string,
) {
  if (hostId !== inventory.hostId)
    throw Error("计算机没有经过验证的运行时目录");
  return {
    kind: "live",
    value: {
      models: nativeRuntimeGroups(inventory, runtime).map((group) => ({
        id:
          group.variants.length === 1
            ? (group.variants[0]!.modelId ?? group.variants[0]!.modelBindingId)
            : group.value,
        label: group.label,
        supportedReasoningEfforts: group.reasoning,
        // This is a verified catalog choice, never an account-health or quota claim.
        verified: "launchable",
      })),
    },
  };
}
export function resolveNativeRuntimeModel(
  inventory: LocalRuntimeInventoryResponse,
  runtime: string,
  value: string,
  effort: string,
  fast: boolean,
) {
  const groups = nativeRuntimeGroups(inventory, runtime),
    group = groups.find(
      (g) =>
        g.value === value ||
        g.variants.some(
          (b) => b.modelBindingId === value || b.modelId === value,
        ),
    );
  if (!group) return;
  return resolveRuntimeModel(groups, group.value, effort, fast);
}
