import type { DatabaseSync } from "node:sqlite";

import {
  ClientPrincipalUpdateRequestSchema,
  ParticipantKindSchema,
  type ClientPrincipalUpdateRequest,
} from "@rah-os/protocol";

import { ConflictError, ForbiddenError } from "./errors.ts";
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
  if (!columns.some((row) => text(row, "name") === "description")) {
    database.exec("ALTER TABLE principals ADD COLUMN description TEXT");
  }
}

export function fromRow(row: Row): Principal {
  const avatarKey = nullableText(row, "avatar_key");
  const displayName = nullableText(row, "display_name");
  const description = nullableText(row, "description");
  return {
    ...(avatarKey === null ? {} : { avatarKey }),
    ...(displayName === null ? {} : { displayName }),
    ...(description === null ? {} : { description }),
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
  const current = {
    displayName: principal.displayName ?? null,
    avatarKey: principal.avatarKey ?? null,
    description: principal.description ?? null,
  };
  const next = {
    displayName: input.displayName,
    avatarKey: input.avatarKey,
    description:
      input.description === undefined
        ? current.description
        : input.description || null,
  };
  const same = (a: typeof current, b: typeof current) =>
    a.displayName === b.displayName &&
    a.avatarKey === b.avatarKey &&
    a.description === b.description;
  if (
    input.expectedProfile &&
    !same(input.expectedProfile, current) &&
    !same(next, current)
  )
    throw new ConflictError(
      "Profile changed in another editor; reload before saving",
    );
  database
    .prepare(
      "UPDATE principals SET display_name = ?, avatar_key = ?, description = ? WHERE principal_id = ?",
    )
    .run(
      next.displayName,
      next.avatarKey,
      next.description,
      principal.principalId,
    );
  const {
    avatarKey: _avatarKey,
    description: _description,
    ...withoutAvatar
  } = principal;
  return {
    ...withoutAvatar,
    ...(input.avatarKey === null ? {} : { avatarKey: input.avatarKey }),
    ...(next.description === null ? {} : { description: next.description }),
    displayName: input.displayName,
  };
}
