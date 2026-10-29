import type {
  RoleTemplate,
  LocalRuntimeInventoryResponse,
} from "@rah-os/protocol";
type Configuration = RoleTemplate["configuration"];
const SIDEBAR_RUNTIME_NAMES = {
  codex: "Codex",
  claude: "Claude",
  kimi: "Kimi",
  opencode: "OpenCode",
  agy: "Agy",
  pi: "Pi",
} as const;
// Compatibility for older Host catalogs without cliId; only exact published labels.
const LEGACY_RUNTIME_NAMES: Record<string, string> = {
  "Codex CLI": "Codex",
  "Claude Code": "Claude",
  "Kimi Code": "Kimi",
  Antigravity: "Agy",
};

/** Remarks never become standing instructions. A combined editor saves one revision. */
export function patchRoleDescription(
  c: Configuration,
  description: string,
  prompt: string,
): Configuration {
  return {
    ...c,
    description: description.trim(),
    role: c.displayName,
    instructions: prompt.trim(),
  };
}
/** Labels use only a verified Host offer; the fallback is presentation, never stored remarks. */
export function rolePresentation(
  c: Configuration,
  inventory?: LocalRuntimeInventoryResponse,
) {
  const runtime = inventory?.runtimes.find(
    (r) => r.runtimeOfferId === c.runtimeOfferId,
  );
  const id = c.modelIntent.exactBindingIds?.[0];
  const model = runtime?.modelBindingDescriptors.find(
    (m) => m.modelBindingId === id,
  );
  const name =
    model?.displayName ??
    model?.modelId ??
    id?.replace(/^local:[^:]+:/u, "") ??
    "未指定模型";
  const fallback = `${name} · ${c.modelIntent.reasoning ?? "默认"}`;
  return {
    description: c.description?.trim() || fallback,
    fallback,
    runtimeLabel: runtime
      ? runtime.cliId
        ? SIDEBAR_RUNTIME_NAMES[runtime.cliId]
        : (LEGACY_RUNTIME_NAMES[runtime.displayName] ?? runtime.displayName)
      : undefined,
  };
}
export function editableRolePrompt(c: Configuration) {
  return c.role === c.displayName || c.role === c.instructions
    ? c.instructions
    : `${c.role}\n\n${c.instructions}`;
}
export function patchRoleText(
  c: Configuration,
  field: "displayName" | "instructions" | "avatarKey",
  value: string,
): Configuration {
  if (field === "instructions")
    return { ...c, role: c.displayName, instructions: value.trim() };
  if (field === "displayName")
    return {
      ...c,
      displayName: value.trim(),
      role: value.trim(),
      instructions: editableRolePrompt(c),
    };
  return { ...c, [field]: value.trim() };
}
