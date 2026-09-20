import { z } from "zod";
import { customModelAllowsEffort } from "./custom-model-effort.ts";

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

/**
 * Provider-native tool/file access selected for an Agent activation.
 *
 * This is intentionally distinct from `minimumIsolation`: some CLIs expose
 * an approval policy rather than an operating-system sandbox. Runtime
 * adapters must map the value honestly to their native controls.
 */
export const ToolAccessModeSchema = z.enum([
  "read_only",
  "workspace_write",
  "full_access",
]);
export type ToolAccessMode = z.infer<typeof ToolAccessModeSchema>;

/**
 * Raft's standard Computer product path is deliberately unattended. The
 * wider ToolAccessMode schema remains readable for historical policy rows,
 * but new Agent product mutations may only write this value.
 */
export const RaftUnattendedToolAccessModeSchema = z.literal("full_access");
export type RaftUnattendedToolAccessMode = z.infer<
  typeof RaftUnattendedToolAccessModeSchema
>;

export const ExplicitReasoningLevelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .refine((value) => value !== "default", {
    message: '"default" is reserved for runtime-owned selection',
  });
export type ExplicitReasoningLevel = z.infer<
  typeof ExplicitReasoningLevelSchema
>;

export const ReasoningLevelSchema = z.union([
  z.literal("default"),
  ExplicitReasoningLevelSchema,
]);
export type ReasoningLevel = z.infer<typeof ReasoningLevelSchema>;

export const ServiceTierSchema = z.enum(["default", "fast", "priority"]);
export type ServiceTier = z.infer<typeof ServiceTierSchema>;

export const ModelCapabilityClassSchema = z.enum([
  "fast",
  "balanced",
  "deep_coding",
]);
export type ModelCapabilityClass = z.infer<typeof ModelCapabilityClassSchema>;

export const CustomModelSchema = z
  .object({
    runtime: z.enum(["claude", "codex"]),
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[^\s\x00-\x1f\x7f]+$/u),
  })
  .strict();

export const ModelIntentSchema = z
  .object({
    customModel: CustomModelSchema.optional(),
    exactBindingIds: UniqueIdentifierArraySchema.min(1).optional(),
    capabilityClass: ModelCapabilityClassSchema.optional(),
    reasoning: ReasoningLevelSchema.optional(),
    serviceTier: ServiceTierSchema.optional(),
    fallback: z.enum(["disabled", "same_profile", "compatible_offer"]),
  })
  .strict()
  .refine(
    (intent) =>
      !intent.customModel ||
      (!intent.exactBindingIds &&
        !intent.capabilityClass &&
        intent.fallback === "disabled" &&
        customModelAllowsEffort(intent.customModel, intent.reasoning) &&
        (!intent.serviceTier || intent.serviceTier === "default")),
    {
      message:
        "custom model requires exclusive selection, disabled fallback, allowed effort and default tier",
    },
  )
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
  displayName: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  capabilityClasses: z
    .array(ModelCapabilityClassSchema)
    .superRefine(rejectDuplicateStrings),
  supportedReasoning: z
    .array(ExplicitReasoningLevelSchema)
    .superRefine(rejectDuplicateStrings),
  supportedServiceTiers: z
    .array(ServiceTierSchema)
    .superRefine(rejectDuplicateStrings),
  reasoningOptions: z
    .array(
      z
        .object({
          value: ExplicitReasoningLevelSchema,
          label: z.string().trim().min(1),
          description: z.string().trim().min(1).optional(),
        })
        .strict(),
    )
    .superRefine((options, context) =>
      rejectDuplicateStrings(
        options.map((option) => option.value),
        context,
      ),
    )
    .optional(),
  defaultReasoning: ExplicitReasoningLevelSchema.optional(),
  evidence: CapabilityEvidenceLevelSchema,
};

function validateModelBindingReasoning(
  binding: {
    defaultReasoning?: string | undefined;
    reasoningOptions?: Array<{ value: string }> | undefined;
    supportedReasoning: string[];
  },
  context: z.RefinementCtx,
): void {
  if (binding.reasoningOptions === undefined) return;
  const observed = new Set(
    binding.reasoningOptions.map((option) => option.value),
  );
  binding.supportedReasoning.forEach((value, index) => {
    if (!observed.has(value)) {
      context.addIssue({
        code: "custom",
        message: `selectable reasoning value is absent from reasoningOptions: ${value}`,
        path: ["supportedReasoning", index],
      });
    }
  });
  if (
    binding.defaultReasoning !== undefined &&
    !observed.has(binding.defaultReasoning)
  ) {
    context.addIssue({
      code: "custom",
      message: "defaultReasoning must appear in reasoningOptions",
      path: ["defaultReasoning"],
    });
  }
}

export const ModelBindingDescriptorSchema = z
  .object(ModelBindingDescriptorFields)
  .strict()
  .superRefine(validateModelBindingReasoning);
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
  .strict()
  .superRefine(validateModelBindingReasoning);
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
    // Legacy policy rows predate this field and launched with full-access
    // flags. Preserve that behavior when replaying durable state; every new
    // product mutation writes the field explicitly.
    toolAccessMode: ToolAccessModeSchema.default("full_access"),
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
