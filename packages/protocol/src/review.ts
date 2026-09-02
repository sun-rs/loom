import { z } from "zod";

import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import { TaskSchema } from "./task.ts";
import { AttachmentSchema } from "./room-files.ts";

export const TaskReviewDispositionSchema = z.enum([
  "approved",
  "changes_requested",
]);
export type TaskReviewDisposition = z.infer<typeof TaskReviewDispositionSchema>;

export const TaskArtifactReferenceSchema = AttachmentSchema.extend({
  ordinal: z.number().int().positive(),
  producerId: IdentifierSchema,
  runAttemptId: IdentifierSchema,
  taskId: IdentifierSchema,
}).strict();
export type TaskArtifactReference = z.infer<typeof TaskArtifactReferenceSchema>;

export const TaskSubmissionSchema = z
  .object({
    artifacts: z.array(TaskArtifactReferenceSchema).max(10).default([]),
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
  .strict()
  .superRefine((submission, context) => {
    const ids = new Set<string>();
    for (const [index, artifact] of submission.artifacts.entries()) {
      if (artifact.ordinal !== index + 1) {
        context.addIssue({
          code: "custom",
          message: "Artifact ordinals must be contiguous and one-based",
          path: ["artifacts", index, "ordinal"],
        });
      }
      if (artifact.taskId !== submission.taskId) {
        context.addIssue({
          code: "custom",
          message: "Artifact must belong to the submitted Task",
          path: ["artifacts", index, "taskId"],
        });
      }
      if (artifact.producerId !== submission.producerId) {
        context.addIssue({
          code: "custom",
          message: "Artifact producer must match the submission producer",
          path: ["artifacts", index, "producerId"],
        });
      }
      if (ids.has(artifact.attachmentId)) {
        context.addIssue({
          code: "custom",
          message: "TaskSubmission Artifact identities must be unique",
          path: ["artifacts", index, "attachmentId"],
        });
      }
      ids.add(artifact.attachmentId);
    }
  });
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
