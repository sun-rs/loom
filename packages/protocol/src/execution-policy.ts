import { z } from "zod";

import { VersionedContentRefSchema } from "./agent-definition.ts";
import {
  ContentDigestSchema,
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";

const UniqueIdentifierArraySchema = z
  .array(IdentifierSchema)
  .superRefine(rejectDuplicateStrings);

export const CapabilityEvidenceLevelSchema = z.enum([
  "declared",
  "probed",
  "certified",
]);
export type CapabilityEvidenceLevel = z.infer<
  typeof CapabilityEvidenceLevelSchema
>;

export const WorkspaceModeSchema = z.enum([
  "in_place",
  "worktree",
  "ephemeral",
]);
export type WorkspaceMode = z.infer<typeof WorkspaceModeSchema>;

export const IsolationLevelSchema = z.enum([
  "none",
  "process",
  "platform",
  "container",
]);
export type IsolationLevel = z.infer<typeof IsolationLevelSchema>;

export const ReasoningLevelSchema = z.enum([
  "default",
  "low",
  "medium",
  "high",
  "max",
]);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ExplicitReasoningLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "max",
]);
export type ExplicitReasoningLevel = z.infer<
  typeof ExplicitReasoningLevelSchema
>;

export const ServiceTierSchema = z.enum(["default", "fast", "priority"]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

export const ModelCapabilityClassSchema = z.enum([
  "fast",
  "balanced",
  "deep_coding",
]);
export type ModelCapabilityClass = z.infer<typeof ModelCapabilityClassSchema>;

export const ModelIntentSchema = z
  .object({
    exactBindingIds: UniqueIdentifierArraySchema.min(1).optional(),
    capabilityClass: ModelCapabilityClassSchema.optional(),
    reasoning: ReasoningLevelSchema.optional(),
    serviceTier: ServiceTierSchema.optional(),
    fallback: z.enum(["disabled", "same_profile", "compatible_offer"]),
  })
  .strict()
  .refine(
    (intent) =>
      intent.exactBindingIds === undefined ||
      intent.capabilityClass === undefined,
    {
      message: "exactBindingIds and capabilityClass are mutually exclusive",
      path: ["capabilityClass"],
    },
  );
export type ModelIntent = z.infer<typeof ModelIntentSchema>;

export const RuntimeCapabilityEvidenceSchema = z
  .object({
    capability: IdentifierSchema,
    evidence: CapabilityEvidenceLevelSchema,
  })
  .strict();
export type RuntimeCapabilityEvidence = z.infer<
  typeof RuntimeCapabilityEvidenceSchema
>;

export const RuntimeCertificationRefSchema = z
  .object({
    certificationId: IdentifierSchema,
    certificationDigest: ContentDigestSchema,
  })
  .strict();
export type RuntimeCertificationRef = z.infer<
  typeof RuntimeCertificationRefSchema
>;

export const RuntimeCertificationSchema = z
  .object({
    certificationId: IdentifierSchema,
    certificationDigest: ContentDigestSchema,
    protocolFamily: IdentifierSchema,
    runtimeProfileDigest: ContentDigestSchema,
    capabilities: UniqueIdentifierArraySchema,
    maximumIsolation: IsolationLevelSchema,
  })
  .strict();
export type RuntimeCertification = z.infer<typeof RuntimeCertificationSchema>;

export const RuntimeCapabilityRequirementSchema = z
  .object({
    capability: IdentifierSchema,
    minimumEvidence: z.enum(["probed", "certified"]),
  })
  .strict();
export type RuntimeCapabilityRequirement = z.infer<
  typeof RuntimeCapabilityRequirementSchema
>;

const ModelBindingDescriptorFields = {
  modelBindingId: IdentifierSchema,
  provider: IdentifierSchema,
  modelId: IdentifierSchema,
  capabilityClasses: z
    .array(ModelCapabilityClassSchema)
    .superRefine(rejectDuplicateStrings),
  supportedReasoning: z
    .array(ExplicitReasoningLevelSchema)
    .superRefine(rejectDuplicateStrings),
  supportedServiceTiers: z
    .array(ServiceTierSchema)
    .superRefine(rejectDuplicateStrings),
  evidence: CapabilityEvidenceLevelSchema,
};

export const ModelBindingDescriptorSchema = z
  .object(ModelBindingDescriptorFields)
  .strict();
export type ModelBindingDescriptor = z.infer<
  typeof ModelBindingDescriptorSchema
>;

export const RuntimeModelBindingSchema = z
  .object({
    ...ModelBindingDescriptorFields,
    adapterMapping: z
      .object({
        kind: IdentifierSchema,
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();
export type RuntimeModelBinding = z.infer<typeof RuntimeModelBindingSchema>;

const PreferenceWeightSchema = z.number().int().positive().max(1_000_000);
const TargetPreferenceSchema = z
  .object({
    criterion: z.enum([
      "runtime_offer",
      "runtime_profile",
      "protocol_family",
      "model_binding",
    ]),
    targetId: IdentifierSchema,
    weight: PreferenceWeightSchema,
  })
  .strict();
const ScalarPreferenceSchema = z
  .object({
    criterion: z.enum(["lower_load", "avoid_structural_failures"]),
    weight: PreferenceWeightSchema,
  })
  .strict();

export const PlacementPreferenceSchema = z.union([
  TargetPreferenceSchema,
  ScalarPreferenceSchema,
]);
export type PlacementPreference = z.infer<typeof PlacementPreferenceSchema>;

export const ExecutionPolicyRevisionSchema = z
  .object({
    executionPolicyId: IdentifierSchema,
    executionPolicyRevisionId: IdentifierSchema,
    controlRoomId: IdentifierSchema,
    revision: z.number().int().positive(),
    contentDigest: ContentDigestSchema,
    required: z
      .object({
        authorizedHostIds: UniqueIdentifierArraySchema.min(1).optional(),
        allowedOfferIds: UniqueIdentifierArraySchema.min(1).optional(),
        allowedProtocolFamilies: UniqueIdentifierArraySchema.min(1),
        capabilities: z.array(RuntimeCapabilityRequirementSchema),
        minimumIsolation: IsolationLevelSchema,
        workspaceMode: WorkspaceModeSchema,
      })
      .strict(),
    preferred: z.array(PlacementPreferenceSchema).max(64),
    modelIntent: ModelIntentSchema,
    sessionPolicy: z.enum(["fresh", "prefer_resume", "require_resume"]),
    retryPolicyRef: VersionedContentRefSchema,
    createdBy: IdentifierSchema,
    createdAt: TimestampSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    rejectDuplicateStrings(
      policy.required.capabilities.map((requirement) => requirement.capability),
      context,
    );
    rejectDuplicateStrings(
      policy.preferred.map((preference) =>
        "targetId" in preference
          ? `${preference.criterion}:${preference.targetId}`
          : preference.criterion,
      ),
      context,
    );
  });
export type ExecutionPolicyRevision = z.infer<
  typeof ExecutionPolicyRevisionSchema
>;
