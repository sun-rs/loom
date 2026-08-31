import { nullableInteger, nullableText, text, type Row } from "./sqlite-row.ts";
import type { HostRecord } from "./types.ts";

export function hostProjectionFromRow(row: Row): HostRecord {
  const participantIds = JSON.parse(text(row, "participant_ids_json"));
  if (
    !Array.isArray(participantIds) ||
    !participantIds.every((value) => typeof value === "string")
  ) {
    throw new Error("expected participant_ids_json to contain strings");
  }
  const state = text(row, "state");
  const buildVersion = nullableText(row, "build_version");
  const processId = nullableInteger(row, "process_id");
  const protocolVersion = nullableInteger(row, "protocol_version");
  if (state !== "online" && state !== "draining" && state !== "offline") {
    throw new Error(`unexpected Host state ${state}`);
  }
  return {
    hostId: text(row, "host_id"),
    instanceId: text(row, "instance_id"),
    participantIds,
    state,
    lastSeenAt: text(row, "last_seen_at"),
    ...(buildVersion === null ? {} : { buildVersion }),
    ...(processId === null ? {} : { processId }),
    ...(protocolVersion === null ? {} : { protocolVersion }),
  };
}
