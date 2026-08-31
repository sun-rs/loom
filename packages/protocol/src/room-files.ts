import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";

// Raft attachmentUploadContract.ts (1.0.18): reservations, verification and 200 MiB.
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export const AttachmentSchema = z
  .object({
    attachmentId: IdentifierSchema,
    filename: z
      .string()
      .min(1)
      .max(255)
      .refine((name) => !/[\x00-\x1f\x7f]/.test(name)),
    mimeType: z.string().max(255),
    size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Attachment = z.infer<typeof AttachmentSchema>;
export const FilePrepareRequestSchema = AttachmentSchema.pick({
  filename: true,
  mimeType: true,
  size: true,
})
  .extend({
    roomId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export const FileUploadSchema = FilePrepareRequestSchema.omit({
  idempotencyKey: true,
})
  .extend({
    attachmentId: IdentifierSchema,
    expiresAt: TimestampSchema,
    state: z.enum([
      "pending",
      "verifying",
      "completed",
      "canceled",
      "expired",
      "failed",
      "consumed",
    ]),
  })
  .strict();
export const FileIdRequestSchema = z
  .object({ attachmentId: IdentifierSchema })
  .strict();
export const RoomFileSchema = AttachmentSchema.extend({
  roomId: IdentifierSchema,
  messageId: IdentifierSchema,
  roomSeq: z.number().int().positive(),
  createdAt: TimestampSchema,
}).strict();
export const RoomFilesRequestSchema = z
  .object({
    roomId: IdentifierSchema,
    cursor: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const RoomFilesResponseSchema = z
  .object({ files: z.array(RoomFileSchema), nextCursor: z.string().optional() })
  .strict();
export type RoomFile = z.infer<typeof RoomFileSchema>;
