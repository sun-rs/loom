import { z } from "zod";

import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import { TaskSchema } from "./task.ts";

export const TaskReviewDispositionSchema = z.enum([
  "approved",
  "changes_requested",
]);
export type TaskReviewDisposition = z.infer<typeof TaskReviewDispositionSchema>;

export const TaskSubmissionSchema = z
  .object({
    createdAt: TimestampSchema,
    messageId: IdentifierSchema,
    producerId: IdentifierSchema,
    roomId: IdentifierSchema,
    submissionDigest: ContentDigestSchema,
    submissionId: IdentifierSchema,
    submissionNumber: z.number().int().positive(),
    summary: z.string().trim().min(1),
    taskId: IdentifierSchema,
  })
  .strict();
export type TaskSubmission = z.infer<typeof TaskSubmissionSchema>;

export const TaskReviewSchema = z
  .object({
    createdAt: TimestampSchema,
    disposition: TaskReviewDispositionSchema,
    messageId: IdentifierSchema,
    reviewId: IdentifierSchema,
    reviewerId: IdentifierSchema,
    roomId: IdentifierSchema,
    submissionDigest: ContentDigestSchema,
    submissionId: IdentifierSchema,
    summary: z.string().trim().min(1),
    taskId: IdentifierSchema,
  })
  .strict();
export type TaskReview = z.infer<typeof TaskReviewSchema>;

const WorkerTaskReviewCommandBaseSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    taskId: IdentifierSchema,
  })
  .strict();

export const WorkerTaskReviewRequestSchema =
  WorkerTaskReviewCommandBaseSchema.extend({
    disposition: TaskReviewDispositionSchema,
    summary: z.string().trim().min(1).max(8_192),
  }).strict();
export type WorkerTaskReviewRequest = z.infer<
  typeof WorkerTaskReviewRequestSchema
>;

export const WorkerTaskReviewResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    review: TaskReviewSchema,
    submission: TaskSubmissionSchema,
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskReviewResponse = z.infer<
  typeof WorkerTaskReviewResponseSchema
>;

export const ClientTaskReviewEvidenceListRequestSchema = z
  .object({ roomId: IdentifierSchema })
  .strict();
export type ClientTaskReviewEvidenceListRequest = z.infer<
  typeof ClientTaskReviewEvidenceListRequestSchema
>;

export const ClientTaskReviewEvidenceListResponseSchema = z
  .object({
    reviews: z.array(TaskReviewSchema),
    submissions: z.array(TaskSubmissionSchema),
  })
  .strict();
export type ClientTaskReviewEvidenceListResponse = z.infer<
  typeof ClientTaskReviewEvidenceListResponseSchema
>;
