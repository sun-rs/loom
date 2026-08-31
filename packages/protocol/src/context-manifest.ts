import { z } from "zod";

import {
  AgentDefinitionRevisionSchema,
  VersionedContentRefSchema,
} from "./agent-definition.ts";
import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";
import { WorkspaceModeSchema } from "./execution-policy.ts";

export const ContextEventRangeSchema = z
  .object({
    fromSeq: z.number().int().positive(),
    toSeq: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.fromSeq <= range.toSeq, {
    message: "fromSeq must not exceed toSeq",
    path: ["fromSeq"],
  });

export const ContextAgentDefinitionSchema = z
  .object({
    agentDefinitionRevisionId:
      AgentDefinitionRevisionSchema.shape.agentDefinitionRevisionId,
    contentDigest: ContentDigestSchema,
    instructionRefs: z.array(VersionedContentRefSchema).max(64),
    memoryPolicyRef: VersionedContentRefSchema,
    skillRefs: z.array(VersionedContentRefSchema).max(64),
  })
  .strict()
  .superRefine((definition, context) => {
    rejectDuplicateStrings(
      [...definition.instructionRefs, ...definition.skillRefs].map(
        (reference) => `${reference.artifactId}:${reference.versionId}`,
      ),
      context,
    );
  });

export const ContextPlacementSchema = z
  .object({
    placementId: IdentifierSchema,
    runtimeProfileDigest: ContentDigestSchema,
    runtimeProfileRevisionId: IdentifierSchema,
    workspaceDefinitionId: IdentifierSchema,
    workspaceMode: WorkspaceModeSchema,
    workspaceMountDigest: ContentDigestSchema,
    workspaceMountRevisionId: IdentifierSchema,
  })
  .strict();

export const ContextManifestSchema = z
  .object({
    activationId: IdentifierSchema,
    agentDefinition: ContextAgentDefinitionSchema.optional(),
    contentDigest: ContentDigestSchema,
    contextManifestId: IdentifierSchema,
    createdAt: TimestampSchema,
    eventRanges: z.array(ContextEventRangeSchema).min(1).max(32),
    participantId: IdentifierSchema,
    placement: ContextPlacementSchema.optional(),
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    schemaVersion: z.literal(1),
    throughRoomSeq: z.number().int().positive(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const finalRange = manifest.eventRanges.at(-1);
    if (finalRange?.toSeq !== manifest.throughRoomSeq) {
      context.addIssue({
        code: "custom",
        message: "throughRoomSeq must equal the final event range",
        path: ["throughRoomSeq"],
      });
    }
    for (let index = 1; index < manifest.eventRanges.length; index += 1) {
      if (
        manifest.eventRanges[index - 1]!.toSeq >=
        manifest.eventRanges[index]!.fromSeq
      ) {
        context.addIssue({
          code: "custom",
          message: "event ranges must be ordered and non-overlapping",
          path: ["eventRanges", index],
        });
      }
    }
    if (
      (manifest.agentDefinition === undefined) !==
      (manifest.placement === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "placement-backed context requires its frozen AgentDefinition",
        path: ["agentDefinition"],
      });
    }
  });
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
