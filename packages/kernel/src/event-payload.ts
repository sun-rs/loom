import type { RoomEvent } from "@rah-os/protocol";

export function eventPayloadText(event: RoomEvent, key: string): string {
  const value = event.payload[key];
  if (typeof value !== "string") {
    throw new Error(`event payload ${key} must be a string`);
  }
  return value;
}

export function eventPayloadOptionalText(
  event: RoomEvent,
  key: string,
): string | undefined {
  const value = event.payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`event payload ${key} must be a string`);
  }
  return value;
}
