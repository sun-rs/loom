import type { RoomAttentionReason } from "./room";

export type RoomActivationState =
  | "queued"
  | "leased"
  | "completed"
  | "quarantined"
  | "cancelled";

export interface RoomActivation {
  activationSeq: number;
  activationId: string;
  roomId: string;
  participantId: string;
  fromSeq: number;
  toSeq: number;
  reason: RoomAttentionReason;
  state: RoomActivationState;
  pulledThroughSeq: number;
  availableAt: string;
  attemptCount: number;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoomActivationEnqueueResult {
  activation: RoomActivation | null;
  deduplicated: boolean;
  receiptId: string;
}

export type RoomRunAttemptState = "prepared" | "running" | "exited" | "failed";

export interface RoomRunAttempt {
  runAttemptId: string;
  activationId: string;
  attemptNumber: number;
  roomId: string;
  participantId: string;
  runtimeProfileId: string;
  provider: string;
  workspace: string;
  state: RoomRunAttemptState;
  providerSessionId?: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomWorkerExecution {
  workerId: string;
  activationId: string;
  leaseToken: string;
  runAttemptId: string;
  roomId: string;
  participantId: string;
  fromSeq: number;
  toSeq: number;
  hostEvidence?: RoomHostObservedSubmissionEvidence;
}

export interface RoomHostObservedSubmissionEvidence {
  schemaVersion: 1;
  workspaceRoot: string;
  baseRevision: string;
  headRevision: string;
  patchDigest: string;
  verificationDigest: string;
  observedAt: string;
}
