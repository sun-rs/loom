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
