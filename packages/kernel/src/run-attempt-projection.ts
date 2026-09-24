import type { DatabaseSync } from "node:sqlite";

import type { PlacementDecision } from "@rah-os/protocol";

import { contextManifestForRunAttempt } from "./context-manifest.ts";
import {
  integer,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";
import type { RunAttempt } from "./types.ts";

export function runAttemptProjectionFromRow(
  database: DatabaseSync,
  row: Row,
  placementFromId: (placementId: string) => PlacementDecision,
): RunAttempt {
  const runAttemptId = text(row, "run_attempt_id");
  const placementId = nullableText(row, "placement_id");
  const runtimeRunId = nullableText(row, "runtime_run_id");
  const exitCode = nullableInteger(row, "exit_code");
  const exitSignal = nullableText(row, "exit_signal");
  const error = nullableText(row, "error");
  const finishedAt = nullableText(row, "finished_at");
  const contextManifest = contextManifestForRunAttempt(database, runAttemptId);
  const instanceRuntimeId = nullableText(row, "instance_runtime_id");
  const nativeTurnId = nullableText(row, "native_turn_id");
  const state = text(row, "state");
  if (
    state !== "starting" &&
    state !== "running" &&
    state !== "orphaned" &&
    state !== "exited" &&
    state !== "failed" &&
    state !== "cancelled" &&
    state !== "timed_out"
  ) {
    throw new Error(`unexpected RunAttempt state ${state}`);
  }
  return {
    activationId: text(row, "activation_id"),
    attemptNumber: integer(row, "attempt_number"),
    ...(contextManifest === undefined ? {} : { contextManifest }),
    ...(error === null ? {} : { error }),
    ...(exitCode === null ? {} : { exitCode }),
    ...(exitSignal === null ? {} : { exitSignal }),
    ...(finishedAt === null ? {} : { finishedAt }),
    hostId: text(row, "host_id"),
    ...(instanceRuntimeId === null ? {} : { instanceRuntimeId }),
    ...(nativeTurnId === null ? {} : { nativeTurnId }),
    participantId: text(row, "participant_id"),
    ...(placementId === null
      ? {}
      : { placement: placementFromId(placementId) }),
    roomId: text(row, "room_id"),
    runAttemptId,
    ...(runtimeRunId === null ? {} : { runtimeRunId }),
    startedAt: text(row, "started_at"),
    state,
  };
}
