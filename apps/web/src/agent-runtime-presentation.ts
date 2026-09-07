import type { LocalRuntimeInventoryEntry, ModelIntent } from "@rah-os/protocol";
import { runtimeReasoningOptions } from "./agent-runtime-capabilities.ts";

/** Inputs must already be scoped to this Agent by the authorized directory. */
export function selectBoundRuntime(
  runtimes: readonly LocalRuntimeInventoryEntry[],
  bindingId?: string,
) {
  if (runtimes.length === 1) return runtimes[0];
  const matching = bindingId
    ? runtimes.filter((r) =>
        r.modelBindingDescriptors.some((m) => m.modelBindingId === bindingId),
      )
    : [];
  return matching.length === 1 ? matching[0] : undefined;
}

/** One meaning for profile chips and compact previews; no requests or state. */
export function runtimeProfilePresentation(
  runtimes: readonly LocalRuntimeInventoryEntry[],
  intent: Partial<ModelIntent> | undefined,
  state: "ready" | "loading" | "error" = "ready",
) {
  const bindingId = intent?.exactBindingIds?.[0];
  const runtime = selectBoundRuntime(runtimes, bindingId);
  const model = runtime?.modelBindingDescriptors.find(
    (m) => m.modelBindingId === bindingId,
  );
  const reasoning = intent?.reasoning;
  // A saved explicit intent remains visible even if discovery is temporarily
  // unavailable. An unsupported default must not pretend to be a capability.
  const showReasoning =
    !!model?.supportedReasoning.length ||
    (!!reasoning && reasoning !== "default");
  return {
    runtime,
    runtimeLabel: runtime
      ? runtimeProductLabel(runtime)
      : runtimes.length > 1
        ? "多个运行时绑定"
        : "未绑定",
    modelLabel: intent
      ? (model?.displayName ??
        model?.modelId ??
        bindingId ??
        intent.capabilityClass ??
        "Runtime 默认")
      : state === "loading"
        ? "加载中…"
        : state === "error"
          ? "暂时无法读取"
          : "配置尚未加载",
    reasoningLabel: showReasoning
      ? !reasoning || reasoning === "default"
        ? "默认"
        : (runtimeReasoningOptions(runtime, bindingId).find(
            (o) => o.value === reasoning,
          )?.label ?? reasoning)
      : undefined,
  };
}

/** Product label only. Preserve exact transport/profile names in diagnostics. */
export function runtimeProductLabel(
  runtime: Pick<
    LocalRuntimeInventoryEntry,
    "executable" | "displayName" | "cliId"
  >,
): string {
  const executable = runtime.executable
    .split(/[\\/]/u)
    .at(-1)
    ?.replace(/\.exe$/iu, "");
  switch (runtime.cliId ?? executable) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "kimi":
      return "Kimi Code";
    case "opencode":
      return "OpenCode";
    default:
      return runtime.displayName;
  }
}
