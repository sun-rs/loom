import type { RahClientOperationMap } from "@rah-os/client-sdk";

export type SavedMessage =
  RahClientOperationMap["message.saved"]["output"]["items"][number];

export function savedTargetLabel(
  roomKind: SavedMessage["roomKind"],
  roomName: string,
  senderName: string,
): string {
  return roomKind === "direct" ? `@${senderName}` : `#${roomName}`;
}

export function formatSavedRelativeTime(
  value: string,
  locale = typeof document === "undefined"
    ? "zh-CN"
    : document.documentElement.lang || "zh-CN",
  now = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const delta = date.getTime() - now.getTime();
  const absolute = Math.abs(delta);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const text =
    absolute < hour
      ? formatter.format(Math.round(delta / minute), "minute")
      : absolute < day
        ? formatter.format(Math.round(delta / hour), "hour")
        : formatter.format(Math.round(delta / day), "day");
  return locale.toLowerCase().startsWith("zh")
    ? text
        .replace(/(\d)\s*([\u3400-\u4dbf\u4e00-\u9fff])/gu, "$1 $2")
        .replace(/([\u3400-\u4dbf\u4e00-\u9fff])\s*(\d)/gu, "$1 $2")
    : text;
}

export function mergeSavedMessages(
  current: SavedMessage[],
  next: SavedMessage[],
): SavedMessage[] {
  const seen = new Set(current.map(({ message }) => message.messageId));
  const merged = [...current];
  for (const row of next) {
    if (seen.has(row.message.messageId)) continue;
    seen.add(row.message.messageId);
    merged.push(row);
  }
  return merged;
}

export function savedContextMenuPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(clientX, viewportWidth - 200)),
    y: Math.max(0, Math.min(clientY, viewportHeight - 100)),
  };
}
