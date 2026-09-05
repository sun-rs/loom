import type { RahTimeFormat } from "./settings-preferences.ts";

function activeTimeFormat(): RahTimeFormat {
  return typeof document !== "undefined" &&
    document.documentElement.dataset.rahTimeFormat === "12"
    ? "12"
    : "24";
}

export function formatRahDateTime(
  value: string | Date,
  options: Intl.DateTimeFormatOptions,
  timeFormat: RahTimeFormat = activeTimeFormat(),
  locales: string | string[] = "zh-CN",
): string {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime()))
    return typeof value === "string" ? value : String(value);
  const includesTime =
    options.timeStyle !== undefined || options.hour !== undefined;
  return new Intl.DateTimeFormat(locales, {
    ...options,
    ...(includesTime ? { hour12: timeFormat === "12" } : {}),
  }).format(parsed);
}
