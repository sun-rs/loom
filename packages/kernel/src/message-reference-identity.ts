import type { DatabaseSync } from "node:sqlite";

import { messageReferenceNameKey } from "@rah-os/protocol";

import { text } from "./sqlite-row.ts";

export function principalHandleIsAvailable(
  database: DatabaseSync,
  handle: string,
): boolean {
  const wanted = messageReferenceNameKey(handle);
  return !database
    .prepare("SELECT handle FROM principals")
    .all()
    .some((row) => messageReferenceNameKey(text(row, "handle")) === wanted);
}

export function workspaceRoomSlugIsAvailable(
  database: DatabaseSync,
  workspaceId: string,
  slug: string,
): boolean {
  const wanted = messageReferenceNameKey(slug);
  return !database
    .prepare("SELECT slug FROM rooms WHERE workspace_id = ?")
    .all(workspaceId)
    .some((row) => messageReferenceNameKey(text(row, "slug")) === wanted);
}

/**
 * Existing databases must satisfy the same identity invariant as new writes.
 * Failing startup is safer than delivering one mention to two principals or
 * making a canonical Room reference resolve differently across clients.
 */
export function assertMessageReferenceDirectoryIsUnambiguous(
  database: DatabaseSync,
): void {
  assertUnique(
    database
      .prepare("SELECT principal_id, handle FROM principals")
      .all()
      .map((row) => ({
        id: text(row, "principal_id"),
        key: messageReferenceNameKey(text(row, "handle")),
      })),
    "principal handle",
  );
  assertUnique(
    database
      .prepare("SELECT workspace_id, room_id, slug FROM rooms")
      .all()
      .map((row) => ({
        id: text(row, "room_id"),
        key: `${text(row, "workspace_id")}\u0000${messageReferenceNameKey(
          text(row, "slug"),
        )}`,
      })),
    "Room slug",
  );
}

function assertUnique(
  identities: readonly { id: string; key: string }[],
  label: string,
): void {
  const firstIdByKey = new Map<string, string>();
  for (const identity of identities) {
    const firstId = firstIdByKey.get(identity.key);
    if (firstId !== undefined && firstId !== identity.id) {
      throw new Error(
        `ambiguous ${label} identity ${JSON.stringify(identity.key)} belongs to both ${firstId} and ${identity.id}`,
      );
    }
    firstIdByKey.set(identity.key, identity.id);
  }
}
