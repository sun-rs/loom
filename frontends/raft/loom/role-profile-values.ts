import type { RoleTemplate } from "@rah-os/protocol";
type Configuration = RoleTemplate["configuration"];
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
