import { z } from "zod";

import { IdentifierSchema } from "./common.ts";

export const PROFILE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const ProfileImageMimeTypeSchema = z.enum(PROFILE_IMAGE_MIME_TYPES);
export type ProfileImageMimeType = z.infer<typeof ProfileImageMimeTypeSchema>;

export const UploadedProfileImageKeySchema = z
  .string()
  .regex(/^upload_(?:jpeg|png|gif|webp)_[a-f0-9]{40}$/u);
export type UploadedProfileImageKey = z.infer<
  typeof UploadedProfileImageKeySchema
>;

export const ProfileImageUploadResponseSchema = z
  .object({
    avatarKey: UploadedProfileImageKeySchema,
    mimeType: ProfileImageMimeTypeSchema,
    size: z.number().int().positive().max(PROFILE_IMAGE_MAX_BYTES),
    uploadIntentId: IdentifierSchema,
  })
  .strict();
export type ProfileImageUploadResponse = z.infer<
  typeof ProfileImageUploadResponseSchema
>;

export function isUploadedProfileImageKey(
  value: string | undefined,
): value is UploadedProfileImageKey {
  return UploadedProfileImageKeySchema.safeParse(value).success;
}

export function profileImageContentPath(avatarKey: string): string {
  return `/v3/client/profile-images/content/${encodeURIComponent(
    UploadedProfileImageKeySchema.parse(avatarKey),
  )}`;
}
