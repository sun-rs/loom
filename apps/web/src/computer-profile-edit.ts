export type ComputerProfileField = "name" | "description";

export function computerProfileEditorAction(
  field: ComputerProfileField,
  key: string,
  metaKey: boolean,
  ctrlKey: boolean,
  composing: boolean,
): "cancel" | "save" | undefined {
  if (composing) return undefined;
  if (key === "Escape") return "cancel";
  if (key === "Enter" && (field === "name" || metaKey || ctrlKey)) {
    return "save";
  }
  return undefined;
}

export function normalizeComputerName(value: string): string {
  return value.replaceAll(/[\r\n]+/gu, " ").trim();
}

export function normalizeComputerDescription(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
