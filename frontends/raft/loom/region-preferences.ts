export type RegionPreferences = {
  timezone: string | null;
  timeFormat: "12h" | "24h" | null;
};
export const REGION_KEY = "loom:region:v1";
const defaults: RegionPreferences = { timezone: null, timeFormat: null };
function validate(value: RegionPreferences) {
  if (
    value.timeFormat !== null &&
    value.timeFormat !== "12h" &&
    value.timeFormat !== "24h"
  )
    throw Error("无效时间格式");
  if (value.timezone !== null) {
    if (typeof value.timezone !== "string" || !value.timezone)
      throw Error("无效时区");
    new Intl.DateTimeFormat("zh-CN", { timeZone: value.timezone }).format();
  }
  return { timezone: value.timezone, timeFormat: value.timeFormat };
}
export function readRegion(
  storage: Pick<Storage, "getItem">,
): RegionPreferences {
  try {
    const raw = storage.getItem(REGION_KEY);
    return raw ? validate(JSON.parse(raw)) : defaults;
  } catch {
    return defaults;
  }
}
export function saveRegion(
  storage: Pick<Storage, "setItem">,
  value: RegionPreferences,
) {
  storage.setItem(REGION_KEY, JSON.stringify(validate(value)));
}
