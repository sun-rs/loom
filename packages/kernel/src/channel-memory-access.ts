import type { DatabaseSync } from "node:sqlite";

import type { ActivationCredentialScope } from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { activeInstancePrivateBoxPredicate } from "./instance-worker-scope.ts";
import { integer, nullableInteger, text } from "./sqlite-row.ts";

export type MemoryAccess = "read" | "write";

/**
 * The kind of Worker credential asking. Every credential issued today is a
 * main-session credential; contract §3 Side sessions (S5, not implemented)
 * must be issued as "side", and this decision refuses them any write. The
 * decision lives in the Kernel, so a side prompt cannot talk its way past it.
 */
export type MemoryCredentialKind = "main" | "side";

export type MemoryAccessDecision =
  { allowed: true } | { allowed: false; reason: string };

/** The single memory access decision, applied before any list or retrieval. */
export function decideMemoryAccess(
  input: {
    credential: MemoryCredentialKind;
    readEnabled: boolean;
    writeEnabled: boolean;
  },
  access: MemoryAccess,
): MemoryAccessDecision {
  if (access === "write" && input.credential === "side")
    return {
      allowed: false,
      reason: "a side session may read channel memory but never write it",
    };
  if (access === "read" && !input.readEnabled)
    return {
      allowed: false,
      reason:
        "channel memory read is turned off for this instance by the Human",
    };
  if (access === "write" && !input.writeEnabled)
    return {
      allowed: false,
      reason:
        "channel memory write is turned off for this instance by the Human",
    };
  return { allowed: true };
}

/** Today every Worker credential is a main-session credential (see above). */
export function workerMemoryCredentialKind(
  _scope: Readonly<ActivationCredentialScope>,
): MemoryCredentialKind {
  return "main";
}

export type MemoryPolicyState = {
  readDefault: boolean;
  revision: number;
  writeDefault: boolean;
};

export function memoryPolicyState(
  database: DatabaseSync,
  channelId: string,
): MemoryPolicyState {
  const row = database
    .prepare("SELECT * FROM memory_access_policies WHERE room_id=?")
    .get(channelId);
  return row === undefined
    ? { readDefault: true, revision: 0, writeDefault: true }
    : {
        readDefault: integer(row, "read_default") === 1,
        revision: integer(row, "revision"),
        writeDefault: integer(row, "write_default") === 1,
      };
}

export function memoryOverride(
  database: DatabaseSync,
  channelId: string,
  instanceId: string,
): { read: boolean | null; write: boolean | null } {
  const row = database
    .prepare(
      "SELECT * FROM memory_access_overrides WHERE room_id=? AND instance_id=?",
    )
    .get(channelId, instanceId);
  const flag = (value: number | null) => (value === null ? null : value === 1);
  return row === undefined
    ? { read: null, write: null }
    : {
        read: flag(nullableInteger(row, "read_enabled")),
        write: flag(nullableInteger(row, "write_enabled")),
      };
}

/** Member override first, then the channel default (default on). */
export function effectiveMemorySwitches(
  database: DatabaseSync,
  channelId: string,
  instanceId: string,
): { read: boolean; write: boolean } {
  const policy = memoryPolicyState(database, channelId);
  const override = memoryOverride(database, channelId, instanceId);
  return {
    read: override.read ?? policy.readDefault,
    write: override.write ?? policy.writeDefault,
  };
}

/**
 * The channel whose memory a Worker credential may reach, before any switch
 * is consulted. Only Role instances have platform memory; the scope is the
 * instance's own channel, never an argument. The instance must still be a
 * member of it. A private-box turn reaches the same channel (the private box
 * shares the instance session, contract §3) while the box is active.
 */
export function workerMemoryChannel(
  database: DatabaseSync,
  scope: Readonly<ActivationCredentialScope>,
): string {
  const instance = database
    .prepare("SELECT channel_id FROM role_instances WHERE instance_id=?")
    .get(scope.participantId);
  if (instance === undefined)
    throw new ForbiddenError(
      "channel memory is available to Role instances only",
    );
  const channelId = text(instance, "channel_id");
  if (
    database
      .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
      .get(channelId, scope.participantId) === undefined
  )
    throw new ForbiddenError(
      "channel memory is unavailable: this instance is no longer a channel member",
    );
  if (scope.roomId === channelId) return channelId;
  const privateBox = database
    .prepare(
      `SELECT 1 FROM rooms r JOIN direct_room_pairs d ON d.room_id=r.room_id
       WHERE r.room_id=:room AND r.kind='direct'
         AND :instance IN (d.left_principal_id, d.right_principal_id)
         AND ${activeInstancePrivateBoxPredicate(":room")}`,
    )
    .get({ room: scope.roomId, instance: scope.participantId });
  if (privateBox === undefined)
    throw new ForbiddenError(
      "channel memory is reachable only from the instance's channel or its active private box",
    );
  return channelId;
}

function workerMemoryDecision(
  database: DatabaseSync,
  scope: Readonly<ActivationCredentialScope>,
  access: MemoryAccess,
): { channelId: string; decision: MemoryAccessDecision } {
  const channelId = workerMemoryChannel(database, scope);
  const switches = effectiveMemorySwitches(
    database,
    channelId,
    scope.participantId,
  );
  const decision = decideMemoryAccess(
    {
      credential: workerMemoryCredentialKind(scope),
      readEnabled: switches.read,
      writeEnabled: switches.write,
    },
    access,
  );
  return { channelId, decision };
}

export function requireMemoryAccess(
  database: DatabaseSync,
  scope: Readonly<ActivationCredentialScope>,
  access: MemoryAccess,
): string {
  const { channelId, decision } = workerMemoryDecision(database, scope, access);
  if (!decision.allowed) throw new ForbiddenError(decision.reason);
  return channelId;
}

/** Whether the Worker may use `access` now, without throwing. */
export function hasMemoryAccess(
  database: DatabaseSync,
  scope: Readonly<ActivationCredentialScope>,
  access: MemoryAccess,
): boolean {
  return workerMemoryDecision(database, scope, access).decision.allowed;
}
