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

export const TaskVerificationDeclarationSchema = z
  .object({
    artifactIds: z.array(IdentifierSchema).max(10).default([]),
    status: z.enum(["passed", "failed", "not_run"]),
    summary: z.string().trim().min(1).max(8_192),
  })
  .strict()
  .superRefine((verification, context) => {
    const seen = new Set<string>();
    verification.artifactIds.forEach((artifactId, index) => {
      if (seen.has(artifactId)) {
        context.addIssue({
          code: "custom",
          message: "Verification Artifact identities must be unique",
          path: ["artifactIds", index],
        });
      }
      seen.add(artifactId);
    });
  });
export type TaskVerificationDeclaration = z.infer<
  typeof TaskVerificationDeclarationSchema
>;

export const TaskSubmissionWorkspaceEvidenceSchema = z.discriminatedUnion(
  "source",
  [
    z
      .object({
        hostId: IdentifierSchema,
        runAttemptId: IdentifierSchema,
        source: z.literal("run_attempt"),
      })
      .strict(),
    z
      .object({
        hostId: IdentifierSchema,
        placementId: IdentifierSchema,
        runAttemptId: IdentifierSchema,
        source: z.literal("placement"),
        workspaceDefinitionId: IdentifierSchema,
        workspaceMode: z.enum(["in_place", "worktree", "ephemeral"]),
        workspaceMountDigest: ContentDigestSchema,
        workspaceMountRevisionId: IdentifierSchema,
      })
      .strict(),
  ],
);
export type TaskSubmissionWorkspaceEvidence = z.infer<
  typeof TaskSubmissionWorkspaceEvidenceSchema
>;

export const TaskSubmissionRepositoryEvidenceSchema = z.discriminatedUnion(
  "source",
  [
    z
      .object({
        reason: z.enum([
          "capture_failed",
          "collector_unavailable",
          "not_git",
          "workspace_not_bound",
        ]),
        source: z.literal("unavailable"),
      })
      .strict(),
    z
      .object({
        baseCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
        headCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
        patchAttachmentId: IdentifierSchema.optional(),
        patchDigest: ContentDigestSchema,
        patchSize: z.number().int().nonnegative(),
        repositoryId: ContentDigestSchema,
        source: z.literal("host_observed"),
        vcs: z.literal("git"),
      })
      .strict()
      .superRefine((repository, context) => {
        if (
          (repository.patchSize === 0) !==
          (repository.patchAttachmentId === undefined)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A non-empty repository patch requires one frozen patch Artifact",
            path: ["patchAttachmentId"],
          });
        }
      }),
  ],
);
export type TaskSubmissionRepositoryEvidence = z.infer<
  typeof TaskSubmissionRepositoryEvidenceSchema
>;

export const TaskSubmissionVerificationEvidenceSchema = z.discriminatedUnion(
  "source",
  [
    z.object({ source: z.literal("not_provided") }).strict(),
    TaskVerificationDeclarationSchema.extend({
      source: z.literal("producer_declared"),
    }).strict(),
  ],
);
export type TaskSubmissionVerificationEvidence = z.infer<
  typeof TaskSubmissionVerificationEvidenceSchema
>;

export const TaskSubmissionEvidenceSchema = z
  .object({
    artifactManifestDigest: ContentDigestSchema,
    repository: TaskSubmissionRepositoryEvidenceSchema,
    schemaVersion: z.literal(1),
    verification: TaskSubmissionVerificationEvidenceSchema,
    workspace: TaskSubmissionWorkspaceEvidenceSchema,
  })
  .strict();
export type TaskSubmissionEvidence = z.infer<
  typeof TaskSubmissionEvidenceSchema
>;

export const TaskSubmissionSchema = z
  .object({
    artifacts: z.array(TaskArtifactReferenceSchema).max(11).default([]),
    createdAt: TimestampSchema,
    evidence: TaskSubmissionEvidenceSchema.optional(),
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
    const evidence = submission.evidence;
    const systemPatchAttachmentId =
      evidence?.repository.source === "host_observed"
        ? evidence.repository.patchAttachmentId
        : undefined;
    const userArtifactCount = submission.artifacts.filter(
      ({ attachmentId }) => attachmentId !== systemPatchAttachmentId,
    ).length;
    if (userArtifactCount > 10) {
      context.addIssue({
        code: "custom",
        message:
          "A Task submission may contain at most 10 producer Artifacts in addition to its system-frozen delivery patch",
        path: ["artifacts"],
      });
    }
    if (evidence === undefined) return;
    for (const [index, artifact] of submission.artifacts.entries()) {
      if (artifact.runAttemptId !== evidence.workspace.runAttemptId) {
        context.addIssue({
          code: "custom",
          message:
            "Frozen submission Artifacts must belong to the evidence RunAttempt",
          path: ["artifacts", index, "runAttemptId"],
        });
      }
    }
    const repository = evidence.repository;
    if (repository.source === "host_observed") {
      const patchArtifact = submission.artifacts.find(
        ({ attachmentId }) => attachmentId === repository.patchAttachmentId,
      );
      if (
        repository.patchAttachmentId !== undefined &&
        (patchArtifact === undefined ||
          `sha256:${patchArtifact.sha256}` !== repository.patchDigest ||
          patchArtifact.size !== repository.patchSize)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Repository patch identity must match its frozen submission Artifact",
          path: ["evidence", "repository", "patchAttachmentId"],
        });
      }
    }
    if (evidence.verification.source === "producer_declared") {
      const artifactIds = new Set(
        submission.artifacts.map(({ attachmentId }) => attachmentId),
      );
      evidence.verification.artifactIds.forEach((attachmentId, index) => {
        if (!artifactIds.has(attachmentId)) {
          context.addIssue({
            code: "custom",
            message:
              "Verification evidence must reference a frozen submission Artifact",
            path: ["evidence", "verification", "artifactIds", index],
          });
        }
      });
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

export const WorkerTaskSubmissionRequestSchema = z
  .object({ taskId: IdentifierSchema })
  .strict();
export type WorkerTaskSubmissionRequest = z.infer<
  typeof WorkerTaskSubmissionRequestSchema
>;
export const WorkerTaskSubmissionResponseSchema = z
  .object({ submission: TaskSubmissionSchema })
  .strict();
export type WorkerTaskSubmissionResponse = z.infer<
  typeof WorkerTaskSubmissionResponseSchema
>;

export const ClientTaskReviewEvidenceListRequestSchema = z
  .object({
    limit: z.number().int().positive().max(500).optional(),
    roomId: IdentifierSchema,
    taskIds: z.array(IdentifierSchema).max(200).optional(),
  })
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
