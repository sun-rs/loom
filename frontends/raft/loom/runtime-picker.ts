import type { LocalRuntimeInventoryEntry } from "@rah-os/protocol";
import type { RuntimeChoice } from "@rah-os/client-core/role-form";
import type { RuntimeOption } from "../packages/web/src/components/agent/RuntimeConfigFields";
/** Presentation-only groups. Selectable values remain exactly the Host-published capability IDs. */
export function runtimePickerOptions(
  rows: readonly LocalRuntimeInventoryEntry[],
  choices: readonly RuntimeChoice[],
  current?: string,
): RuntimeOption[] {
  const configured = new Set(
    rows.filter((r) => r.configured && r.cliId).map((r) => r.cliId),
  );
  const groups: RuntimeOption[][] = [[], [], [], []];
  rows.forEach((runtime, index) => {
    if (!runtime.configured && runtime.cliId && configured.has(runtime.cliId))
      return;
    const ready =
      runtime.available &&
      !!runtime.runtimeOfferId &&
      runtime.modelBindingDescriptors.length > 0 &&
      choices.some((r) => r.runtimeOfferId === runtime.runtimeOfferId);
    const missing =
      !runtime.available &&
      (runtime.failureCode === "executable_not_found" ||
        (runtime.source === "discovered" && !runtime.resolvedExecutablePath));
    const selected = !!current && runtime.runtimeOfferId === current;
    const group = selected ? 0 : ready ? 1 : missing ? 3 : 2;
    groups[group]!.push({
      value:
        runtime.runtimeOfferId ??
        `unavailable:${runtime.cliId ?? runtime.executable}:${index}`,
      label: runtime.displayName,
      disabled: !ready,
      group: [
        "当前运行时",
        "此计算机上已就绪",
        "此计算机上不可用",
        "此计算机未安装",
      ][group],
      ...(!ready
        ? {
            description: missing
              ? "此计算机未检测到该运行时"
              : runtime.failureCode
                ? `运行时探测未就绪（${runtime.failureCode}）`
                : "模型目录尚未就绪",
          }
        : {}),
    });
  });
  return groups.flat();
}
