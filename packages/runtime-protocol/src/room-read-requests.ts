import type {
  RoomBootstrapReadRequest,
  RoomEventReadRequest,
  RoomInboxReadRequest,
  RoomListReadRequest,
  RoomOlderMessagesReadRequest,
  RoomTaskListReadRequest,
} from "./room-read";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function object(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function identifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${name} must be a stable identifier`);
  }
}

function limit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 500) {
    throw new Error("limit must be between 1 and 500");
  }
  return Number(value);
}

function cursor(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096) {
    throw new Error("cursor must contain 1 to 4096 characters");
  }
  return value;
}

function exact(
  value: Record<string, unknown>,
  allowed: string[],
  name: string,
): void {
  const keys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown) throw new Error(`${name} contains unknown field ${unknown}`);
}

function request(
  value: unknown,
  name: string,
  options: { cursor: "forbidden" | "optional" | "required"; room: boolean },
): { roomId?: string; cursor?: string; limit?: number } {
  object(value, name);
  const allowed = [
    ...(options.room ? ["roomId"] : []),
    ...(options.cursor === "forbidden" ? [] : ["cursor"]),
    "limit",
  ];
  exact(value, allowed, name);
  if (options.room) identifier(value.roomId, "roomId");
  const nextCursor =
    options.cursor === "forbidden"
      ? undefined
      : cursor(value.cursor, options.cursor === "required");
  const nextLimit = limit(value.limit);
  return {
    ...(options.room ? { roomId: value.roomId as string } : {}),
    ...(nextCursor ? { cursor: nextCursor } : {}),
    ...(nextLimit ? { limit: nextLimit } : {}),
  };
}

export function validateRoomBootstrapReadRequest(
  value: unknown,
): RoomBootstrapReadRequest {
  return request(value, "RoomBootstrapReadRequest", {
    cursor: "forbidden",
    room: true,
  }) as RoomBootstrapReadRequest;
}

export function validateRoomEventReadRequest(
  value: unknown,
): RoomEventReadRequest {
  return request(value, "RoomEventReadRequest", {
    cursor: "required",
    room: true,
  }) as RoomEventReadRequest;
}

export function validateRoomOlderMessagesReadRequest(
  value: unknown,
): RoomOlderMessagesReadRequest {
  return request(value, "RoomOlderMessagesReadRequest", {
    cursor: "required",
    room: true,
  }) as RoomOlderMessagesReadRequest;
}

export function validateRoomInboxReadRequest(
  value: unknown,
): RoomInboxReadRequest {
  object(value, "RoomInboxReadRequest");
  exact(
    value,
    ["cursor", "start", "limit", "roomId", "pendingOnly", "messageIds", "taskIds"],
    "RoomInboxReadRequest",
  );
  const nextCursor = cursor(value.cursor, false);
  const nextLimit = limit(value.limit);
  if (value.start !== undefined && value.start !== "latest") {
    throw new Error("RoomInboxReadRequest.start must be latest");
  }
  if (value.roomId !== undefined) identifier(value.roomId, "roomId");
  if (
    value.pendingOnly !== undefined &&
    typeof value.pendingOnly !== "boolean"
  ) {
    throw new Error("pendingOnly must be a boolean");
  }
  const targets = (raw: unknown, field: string): string[] | undefined => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length > 500) {
      throw new Error(`${field} is invalid`);
    }
    for (const id of raw) identifier(id, `${field}[]`);
    if (new Set(raw).size !== raw.length) {
      throw new Error(`${field} must not contain duplicates`);
    }
    return raw as string[];
  };
  const messageIds = targets(value.messageIds, "messageIds");
  const taskIds = targets(value.taskIds, "taskIds");
  if ((messageIds || taskIds) && !value.roomId) {
    throw new Error("Inbox target filters require roomId");
  }
  if (
    (value.roomId !== undefined ||
      value.pendingOnly !== undefined ||
      messageIds ||
      taskIds) &&
    nextCursor
  ) {
    throw new Error("filtered Inbox reads do not accept a global cursor");
  }
  if (
    value.start === "latest" &&
    (nextCursor ||
      value.roomId !== undefined ||
      value.pendingOnly !== undefined ||
      messageIds ||
      taskIds)
  ) {
    throw new Error("latest Inbox cursor reads do not accept a cursor or filters");
  }
  if ((messageIds?.length ?? 0) + (taskIds?.length ?? 0) > 500) {
    throw new Error("Inbox target filters contain more than 500 identifiers");
  }
  return {
    ...(nextCursor ? { cursor: nextCursor } : {}),
    ...(value.start === "latest" ? { start: "latest" as const } : {}),
    ...(nextLimit ? { limit: nextLimit } : {}),
    ...(typeof value.roomId === "string" ? { roomId: value.roomId } : {}),
    ...(typeof value.pendingOnly === "boolean"
      ? { pendingOnly: value.pendingOnly }
      : {}),
    ...(messageIds ? { messageIds } : {}),
    ...(taskIds ? { taskIds } : {}),
  };
}

export function validateRoomListReadRequest(
  value: unknown,
): RoomListReadRequest {
  return request(value, "RoomListReadRequest", {
    cursor: "optional",
    room: false,
  }) as RoomListReadRequest;
}

export function validateRoomTaskListReadRequest(
  value: unknown,
): RoomTaskListReadRequest {
  const parsed = request(value, "RoomTaskListReadRequest", {
    cursor: "optional",
    room: true,
  }) as RoomTaskListReadRequest;
  if (parsed.limit !== undefined && parsed.limit > 100) {
    throw new Error("RoomTaskListReadRequest.limit must be between 1 and 100");
  }
  return parsed;
}
