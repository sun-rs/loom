import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  assertRoomTextStorageSafe,
  isRoomAgentAvatarKey,
  ROOM_AGENT_AVATAR_KEYS,
  type RoomAgentAvatarKey,
  type RoomPrincipal,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import { principalFromRow, text, type RoomSqlRow as Row } from "./room-rows";

const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class RoomPrincipalService {
  constructor(
    private readonly options: {
      database: DatabaseSync;
      createId: (prefix: string) => string;
      chooseAvatarIndex: (size: number) => number;
      timestamp: () => string;
      transaction: <T>(operation: () => T) => T;
      storageError: (error: unknown) => Error;
    },
  ) {}

  provision(input: {
    principalId: string;
    handle: string;
    kind: RoomPrincipal["kind"];
    displayName?: string;
    avatarKey?: RoomAgentAvatarKey;
  }): RoomPrincipal {
    if (!STABLE_IDENTIFIER.test(input.principalId)) {
      throw roomError(
        "invalid_argument",
        "principalId must be a stable identifier",
      );
    }
    if (!STABLE_IDENTIFIER.test(input.handle)) {
      throw roomError("invalid_argument", "handle must be a stable identifier");
    }
    if (!new Set(["human", "agent", "service"]).has(input.kind)) {
      throw roomError(
        "invalid_argument",
        "principal kind must be human, agent, or service",
      );
    }
    if (
      input.avatarKey !== undefined &&
      (input.kind !== "agent" || !isRoomAgentAvatarKey(input.avatarKey))
    ) {
      throw roomError(
        "invalid_argument",
        "avatarKey must be an official Agent avatar key",
      );
    }
    const displayName = input.displayName?.trim();
    if (
      displayName !== undefined &&
      (displayName.length < 1 || displayName.length > 120)
    ) {
      throw roomError(
        "invalid_argument",
        "displayName must contain 1 to 120 characters",
      );
    }
    if (displayName !== undefined) {
      try {
        assertRoomTextStorageSafe(displayName, "displayName");
      } catch (error) {
        throw roomError(
          "invalid_argument",
          error instanceof Error
            ? error.message
            : "displayName is not storage-safe",
        );
      }
    }
    const existing = this.options.database
      .prepare("SELECT * FROM room_principals WHERE principal_id = ?")
      .get(input.principalId) as Row | undefined;
    if (existing) {
      const principal = principalFromRow(existing);
      if (
        principal.handle !== input.handle ||
        principal.kind !== input.kind ||
        principal.displayName !== displayName ||
        (input.avatarKey !== undefined &&
          principal.avatarKey !== input.avatarKey)
      ) {
        throw roomError(
          "conflict",
          `principal ${input.principalId} already has a different definition`,
        );
      }
      return principal;
    }
    if (this.#byHandle(input.handle)) {
      throw roomError("conflict", `handle ${input.handle} is already in use`);
    }
    const createdAt = this.options.timestamp();
    const avatarKey =
      input.kind === "agent"
        ? (input.avatarKey ?? this.#allocateAvatarKey())
        : undefined;
    try {
      this.options.database
        .prepare(
          "INSERT INTO room_principals(principal_id, handle, kind, display_name, avatar_key, created_at) VALUES(?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.principalId,
          input.handle,
          input.kind,
          displayName ?? null,
          avatarKey ?? null,
          createdAt,
        );
    } catch (error) {
      throw this.options.storageError(error);
    }
    return {
      principalId: input.principalId,
      handle: input.handle,
      kind: input.kind,
      ...(displayName ? { displayName } : {}),
      ...(avatarKey ? { avatarKey } : {}),
      createdAt,
    };
  }

  backfillAgentAvatarKeys(): void {
    const rows = this.options.database
      .prepare(
        `SELECT principal_id, avatar_key FROM room_principals
         WHERE kind = 'agent' ORDER BY created_at, principal_id`,
      )
      .all() as Row[];
    const missing = rows.filter((row) => !isRoomAgentAvatarKey(row.avatar_key));
    if (missing.length === 0) return;
    this.options.transaction(() => {
      const update = this.options.database.prepare(
        "UPDATE room_principals SET avatar_key = ? WHERE principal_id = ?",
      );
      for (const row of missing) {
        update.run(this.#allocateAvatarKey(), text(row, "principal_id"));
      }
    });
  }

  ensureLocalHuman(
    input: { handle?: string; displayName?: string } = {},
  ): RoomPrincipal {
    const existing = this.options.database
      .prepare(
        "SELECT value FROM room_metadata WHERE key = 'local_human_principal_id'",
      )
      .get() as Row | undefined;
    if (existing) return this.#require(text(existing, "value"));
    return this.options.transaction(() => {
      const raced = this.options.database
        .prepare(
          "SELECT value FROM room_metadata WHERE key = 'local_human_principal_id'",
        )
        .get() as Row | undefined;
      if (raced) return this.#require(text(raced, "value"));
      const principalId = this.options.createId("principal");
      const preferredHandle = input.handle ?? "owner";
      const handle = this.#byHandle(preferredHandle)
        ? `${preferredHandle.slice(0, 110)}-${createHash("sha256")
            .update(principalId)
            .digest("hex")
            .slice(0, 12)}`
        : preferredHandle;
      const principal = this.provision({
        principalId,
        handle,
        kind: "human",
        displayName: input.displayName ?? "Owner",
      });
      this.options.database
        .prepare(
          "INSERT INTO room_metadata(key, value) VALUES('local_human_principal_id', ?)",
        )
        .run(principal.principalId);
      return principal;
    });
  }

  #allocateAvatarKey(): RoomAgentAvatarKey {
    const counts = new Map<RoomAgentAvatarKey, number>(
      ROOM_AGENT_AVATAR_KEYS.map((key) => [key, 0]),
    );
    for (const row of this.options.database
      .prepare(
        "SELECT avatar_key FROM room_principals WHERE kind = 'agent' AND avatar_key IS NOT NULL",
      )
      .all() as Array<{ avatar_key?: unknown }>) {
      if (isRoomAgentAvatarKey(row.avatar_key)) {
        counts.set(row.avatar_key, (counts.get(row.avatar_key) ?? 0) + 1);
      }
    }
    const leastUsed = Math.min(...counts.values());
    const available = ROOM_AGENT_AVATAR_KEYS.filter(
      (key) => counts.get(key) === leastUsed,
    );
    const index = this.options.chooseAvatarIndex(available.length);
    if (!Number.isInteger(index) || index < 0 || index >= available.length) {
      throw roomError(
        "invalid_argument",
        "official Agent avatar selection failed",
      );
    }
    return available[index]!;
  }

  #require(principalId: string): RoomPrincipal {
    const row = this.options.database
      .prepare("SELECT * FROM room_principals WHERE principal_id = ?")
      .get(principalId) as Row | undefined;
    if (!row)
      throw roomError("not_found", `principal ${principalId} was not found`);
    return principalFromRow(row);
  }

  #byHandle(handle: string): RoomPrincipal | undefined {
    const row = this.options.database
      .prepare("SELECT * FROM room_principals WHERE handle = ?")
      .get(handle) as Row | undefined;
    return row ? principalFromRow(row) : undefined;
  }
}
