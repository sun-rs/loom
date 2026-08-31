import { RuntimeRecoveryDescriptorSchema } from "@rah-os/protocol";
import {
  integer,
  jsonObject,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";
import type { RuntimeProcessRecord } from "./types.ts";

// Storage projection only; lifecycle transitions remain owned by RoomKernel.
export function runtimeProcessProjectionFromRow(
  row: Row,
): RuntimeProcessRecord {
  const state = text(row, "state");
  if (
    state !== "prepared" &&
    state !== "active" &&
    state !== "orphaned" &&
    state !== "terminated"
  ) {
    throw new Error(`unexpected RuntimeProcess state ${state}`);
  }
  const exitCode = nullableInteger(row, "exit_code");
  const exitSignal = nullableText(row, "exit_signal");
  const terminatedAt = nullableText(row, "terminated_at");
  const recoveryLeaseOwner = nullableText(row, "recovery_lease_owner");
  const recoveryLeaseOwnerInstanceId = nullableText(
    row,
    "recovery_lease_owner_instance_id",
  );
  const recoveryLeaseUntil = nullableText(row, "recovery_lease_until");
  const recoveryLastError = nullableText(row, "recovery_last_error");
  return {
    runtimeProcessId: text(row, "runtime_process_id"),
    runAttemptId: text(row, "run_attempt_id"),
    activationId: text(row, "activation_id"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    launchHostId: text(row, "launch_host_id"),
    runtimeRunId: text(row, "runtime_run_id"),
    recoveryDescriptor: RuntimeRecoveryDescriptorSchema.parse(
      jsonObject(row, "recovery_descriptor_json"),
    ),
    state,
    registeredAt: text(row, "registered_at"),
    updatedAt: text(row, "updated_at"),
    recoveryAttemptCount: integer(row, "recovery_attempt_count"),
    ...(recoveryLeaseOwner === null ? {} : { recoveryLeaseOwner }),
    ...(recoveryLeaseOwnerInstanceId === null
      ? {}
      : { recoveryLeaseOwnerInstanceId }),
    ...(recoveryLeaseUntil === null ? {} : { recoveryLeaseUntil }),
    ...(recoveryLastError === null ? {} : { recoveryLastError }),
    ...(exitCode === null ? {} : { exitCode }),
    ...(exitSignal === null ? {} : { exitSignal }),
    ...(terminatedAt === null ? {} : { terminatedAt }),
  };
}
