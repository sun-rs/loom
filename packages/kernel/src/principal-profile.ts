import type { DatabaseSync } from "node:sqlite";

import {
  ClientPrincipalUpdateRequestSchema,
  ParticipantKindSchema,
  type ClientPrincipalUpdateRequest,
} from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import type { Principal } from "./types.ts";

export function migrate(database: DatabaseSync): void {
  const columns = database.prepare("PRAGMA table_info(principals)").all();
  if (!columns.some((row) => text(row, "name") === "display_name")) {
    database.exec("ALTER TABLE principals ADD COLUMN display_name TEXT");
  }
  if (!columns.some((row) => text(row, "name") === "avatar_key")) {
    database.exec("ALTER TABLE principals ADD COLUMN avatar_key TEXT");
  }
}

export function fromRow(row: Row): Principal {
  const avatarKey = nullableText(row, "avatar_key");
  const displayName = nullableText(row, "display_name");
  return {
    ...(avatarKey === null ? {} : { avatarKey }),
    ...(displayName === null ? {} : { displayName }),
    handle: text(row, "handle"),
    kind: ParticipantKindSchema.parse(text(row, "kind")),
    principalId: text(row, "principal_id"),
  };
}

export function update(
  database: DatabaseSync,
  principal: Principal,
  rawInput: ClientPrincipalUpdateRequest,
): Principal {
  if (principal.kind !== "human") {
    throw new ForbiddenError("only Human principals can update a profile");
  }
  const input = ClientPrincipalUpdateRequestSchema.parse(rawInput);
  database
    .prepare(
      "UPDATE principals SET display_name = ?, avatar_key = ? WHERE principal_id = ?",
    )
    .run(input.displayName, input.avatarKey, principal.principalId);
  const { avatarKey: _avatarKey, ...withoutAvatar } = principal;
  return {
    ...withoutAvatar,
    ...(input.avatarKey === null ? {} : { avatarKey: input.avatarKey }),
    displayName: input.displayName,
  };
}
