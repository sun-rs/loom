import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { OFFICIAL_AGENT_AVATAR_KEYS } from "./official-agent-avatars.ts";
import { UploadedProfileImageKeySchema } from "./profile-image.ts";

const Name = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/[\r\n]/u.test(value), "displayName must be one line");
const Avatar = z
  .string()
  .refine(
    (value) =>
      OFFICIAL_AGENT_AVATAR_KEYS.includes(value) ||
      UploadedProfileImageKeySchema.safeParse(value).success,
    "avatar must be an official key or a verified upload",
  );
export const WorkerSelfProfileWriteContextSchema = z
  .object({
    controlRoomId: IdentifierSchema,
    controlRoomSeq: z.number().int().nonnegative(),
    expectedRevisionId: IdentifierSchema,
  })
  .strict();
export const WorkerSelfProfilePatchSchema = z
  .object({
    displayName: Name.optional(),
    description: z.string().trim().max(2000).optional(),
    avatarKey: Avatar.optional(),
    avatarUploadIntentId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((patch, context) => {
    if (
      patch.displayName === undefined &&
      patch.description === undefined &&
      patch.avatarKey === undefined
    )
      context.addIssue({
        code: "custom",
        message: "at least one metadata field is required",
      });
    if (
      patch.avatarUploadIntentId !== undefined &&
      patch.avatarKey === undefined
    )
      context.addIssue({
        code: "custom",
        message: "avatarUploadIntentId requires an avatarKey",
      });
  });
export const WorkerSelfProfileGetRequestSchema = z.object({}).strict();
/**
 * Raft's `POST /profile` body is `{ avatarUrl?, displayName?, description? }`
 * and its CLI carries no write context at all: the bound credential already
 * names the profile. RAH's daemon granted the Activation and therefore already
 * knows the control Room, its sequence and the revision this Run observed, so
 * every write-context field is optional and resolved server-side. Optimistic
 * concurrency is unchanged: the expected revision is the one this Run last saw,
 * so an update committed by anyone else in between still fails.
 */
export const WorkerSelfProfileUpdateRequestSchema = z
  .object({
    writeContext: WorkerSelfProfileWriteContextSchema.partial().optional(),
    idempotencyKey: IdentifierSchema.optional(),
    patch: WorkerSelfProfilePatchSchema,
  })
  .strict();
export const WorkerSelfProfileResponseSchema = z
  .object({
    profile: z
      .object({
        participantId: IdentifierSchema,
        agentDefinitionId: IdentifierSchema,
        displayName: z.string().min(1).max(128),
        description: z.string().max(3000).optional(),
        avatarKey: IdentifierSchema.optional(),
      })
      .strict(),
    writeContext: WorkerSelfProfileWriteContextSchema,
  })
  .strict();
export const WorkerSelfProfileUpdateResponseSchema =
  WorkerSelfProfileResponseSchema.extend({
    deduplicated: z.boolean(),
  }).strict();
export type WorkerSelfProfileWriteContext = z.infer<
  typeof WorkerSelfProfileWriteContextSchema
>;
export type WorkerSelfProfilePatch = z.infer<
  typeof WorkerSelfProfilePatchSchema
>;
export type WorkerSelfProfileUpdateRequest = z.input<
  typeof WorkerSelfProfileUpdateRequestSchema
>;
export type WorkerSelfProfileResponse = z.infer<
  typeof WorkerSelfProfileResponseSchema
>;
export type WorkerSelfProfileUpdateResponse = z.infer<
  typeof WorkerSelfProfileUpdateResponseSchema
>;
