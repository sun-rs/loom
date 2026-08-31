import { z } from "zod";

import { VersionedContentRefSchema } from "./agent-definition.ts";
import { AgentMemoryRunSourceSchema } from "./agent-memory-project.ts";
import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from "./common.ts";

export const AgentMemoryRelativePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      value === "MEMORY.md" ||
      (value.startsWith("notes/") &&
        !value.startsWith("notes//") &&
        !value.endsWith("/") &&
        !value
          .split("/")
          .some((part) => part === "" || part === "." || part === "..") &&
        !value.includes("\\") &&
        !/[\u0000-\u001f\u007f]/u.test(value)),
    "Agent memory relative path must be MEMORY.md or a safe notes/ path",
  );

export const AgentMemoryMaterializedFileSchema = z
  .object({
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    contentDigest: ContentDigestSchema,
    modifiedAt: TimestampSchema,
    relativePath: AgentMemoryRelativePathSchema,
  })
  .strict();
export type AgentMemoryMaterializedFile = z.infer<
  typeof AgentMemoryMaterializedFileSchema
>;

const AgentMemoryReceiptFields = z
  .object({
    activationId: IdentifierSchema,
    agentDefinitionRevisionId: IdentifierSchema,
    computerHostId: IdentifierSchema,
    materializedAt: TimestampSchema,
    memoryPolicyRef: VersionedContentRefSchema,
    ownerParticipantId: IdentifierSchema,
    proofScope: z.literal("computer_materialized_not_model_read"),
    receiptId: ContentDigestSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    source: AgentMemoryRunSourceSchema.optional(),
  })
  .strict();

// v1 remains readable as historical evidence; new launches must never pretend
// an index-only observation revalidates a legacy full-tree snapshot.
const LegacyAgentMemoryReceiptSchema = AgentMemoryReceiptFields.extend({
  files: z.array(AgentMemoryMaterializedFileSchema).min(1).max(4_097),
  schemaVersion: z.literal(1),
  snapshotDigest: ContentDigestSchema,
});
const IndexOnlyAgentMemoryReceiptSchema = AgentMemoryReceiptFields.extend({
  coverage: z.literal("index_only"),
  files: z.tuple([AgentMemoryMaterializedFileSchema]),
  schemaVersion: z.literal(2),
});

export const AgentMemoryMaterializationReceiptSchema = z
  .discriminatedUnion("schemaVersion", [
    LegacyAgentMemoryReceiptSchema,
    IndexOnlyAgentMemoryReceiptSchema,
  ])
  .superRefine((receipt, context) => {
    addOrderedMemoryFileIssues(receipt.files, context, "receipt");
  });
export type AgentMemoryMaterializationReceipt = z.infer<
  typeof AgentMemoryMaterializationReceiptSchema
>;

const AgentMemoryAbsentWorkspaceSchema = z
  .object({
    files: z.tuple([]),
    ownerParticipantId: IdentifierSchema,
    schemaVersion: z.literal(1),
    state: z.literal("absent"),
    thresholdBytes: z.number().int().positive(),
  })
  .strict();

const AgentMemoryReadyWorkspaceSchema = z
  .object({
    files: z.array(AgentMemoryMaterializedFileSchema).min(1).max(4_097),
    indexOverThreshold: z.boolean(),
    noteCount: z.number().int().nonnegative().max(4_096),
    ownerParticipantId: IdentifierSchema,
    schemaVersion: z.literal(1),
    state: z.literal("ready"),
    thresholdBytes: z.number().int().positive(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    addOrderedMemoryFileIssues(snapshot.files, context, "workspace");
    if (snapshot.noteCount !== snapshot.files.length - 1) {
      context.addIssue({
        code: "custom",
        message: "Agent memory note count does not match the file tree",
        path: ["noteCount"],
      });
    }
  });

export const AgentMemoryWorkspaceSnapshotSchema = z.discriminatedUnion(
  "state",
  [AgentMemoryAbsentWorkspaceSchema, AgentMemoryReadyWorkspaceSchema],
);
export type AgentMemoryWorkspaceSnapshot = z.infer<
  typeof AgentMemoryWorkspaceSnapshotSchema
>;

export const ClientAgentMemoryGetRequestSchema = z
  .object({ agentDefinitionId: IdentifierSchema })
  .strict();
export type ClientAgentMemoryGetRequest = z.infer<
  typeof ClientAgentMemoryGetRequestSchema
>;

export const ClientAgentMemoryGetResponseSchema = z
  .object({
    computerHostId: IdentifierSchema,
    memory: AgentMemoryWorkspaceSnapshotSchema,
  })
  .strict();
export type ClientAgentMemoryGetResponse = z.infer<
  typeof ClientAgentMemoryGetResponseSchema
>;

export const ClientAgentMemoryReadRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    relativePath: AgentMemoryRelativePathSchema,
  })
  .strict();
export type ClientAgentMemoryReadRequest = z.infer<
  typeof ClientAgentMemoryReadRequestSchema
>;

export const ClientAgentMemoryReadResponseSchema = z
  .object({
    computerHostId: IdentifierSchema,
    content: z.string().max(1_048_576),
    file: AgentMemoryMaterializedFileSchema,
    ownerParticipantId: IdentifierSchema,
  })
  .strict();
export type ClientAgentMemoryReadResponse = z.infer<
  typeof ClientAgentMemoryReadResponseSchema
>;

export const ClientAgentMemoryResetRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    confirmation: z.literal("RESET_AGENT_MEMORY"),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientAgentMemoryResetRequest = z.infer<
  typeof ClientAgentMemoryResetRequestSchema
>;

export const ClientAgentMemoryResetResponseSchema = z
  .object({
    computerHostId: IdentifierSchema,
    deduplicated: z.boolean(),
    operationId: IdentifierSchema,
    ownerParticipantId: IdentifierSchema,
    providerContinuityRecords: z.number().int().nonnegative(),
    resetAt: TimestampSchema,
  })
  .strict();
export type ClientAgentMemoryResetResponse = z.infer<
  typeof ClientAgentMemoryResetResponseSchema
>;

function addOrderedMemoryFileIssues(
  files: AgentMemoryMaterializedFile[],
  context: z.RefinementCtx,
  owner: "receipt" | "workspace",
): void {
  if (files[0]?.relativePath !== "MEMORY.md") {
    context.addIssue({
      code: "custom",
      message: `Agent memory ${owner} must begin with MEMORY.md`,
      path: ["files", 0, "relativePath"],
    });
  }
  const seen = new Set<string>();
  files.forEach((file, index) => {
    if (seen.has(file.relativePath)) {
      context.addIssue({
        code: "custom",
        message: `duplicate Agent memory path: ${file.relativePath}`,
        path: ["files", index, "relativePath"],
      });
    }
    seen.add(file.relativePath);
    if (index > 1) {
      const previous = files[index - 1]!;
      if (previous.relativePath.localeCompare(file.relativePath) >= 0) {
        context.addIssue({
          code: "custom",
          message: "Agent memory note paths must be strictly sorted",
          path: ["files", index, "relativePath"],
        });
      }
    }
  });
}
