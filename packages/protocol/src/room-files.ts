import {
  WorkerReadChannelSchema,
  WorkerTargetReceiptSchema,
} from "./worker-target-reference.ts";
import { attachmentMediaPreview } from "./attachment-media.ts";
export {
  attachmentMediaPreview,
  MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES,
} from "./attachment-media.ts";
import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";

// Raft attachmentUploadContract.ts (1.0.18): reservations, verification and 200 MiB.
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;
// Local reservation lifetime; shared by actual preparation and capability reads.
export const ATTACHMENT_UPLOAD_SESSION_EXPIRES_IN_SECONDS = 60 * 60;
export const MAX_ATTACHMENT_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
export const AttachmentPreviewKindSchema = z.enum([
  "image",
  "pdf",
  "video",
  "audio",
  "markdown",
  "html",
  "diff",
  "csv",
  "text",
  "unsupported",
]);
export type AttachmentPreviewKind = z.infer<typeof AttachmentPreviewKindSchema>;

const TEXT_PREVIEW_MIME_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/xml",
  "application/x-httpd-php",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "image/svg+xml",
]);
const TEXT_PREVIEW_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "conf",
  "cpp",
  "cs",
  "css",
  "env",
  "gitignore",
  "go",
  "h",
  "hpp",
  "ini",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "less",
  "log",
  "lua",
  "makefile",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svg",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vim",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const TEXT_PREVIEW_BASENAMES = new Set([
  ".env",
  ".gitignore",
  "dockerfile",
  "makefile",
]);

/**
 * Raft-compatible preview dispatch with Multica's text whitelist kept in one
 * provider-neutral owner. SVG is deliberately text, not an executable image.
 */
export function classifyAttachmentPreview(
  mimeType: string,
  filename: string,
): AttachmentPreviewKind {
  const normalizedMime = mimeType.toLowerCase().split(";", 1)[0]!.trim();
  const basename = filename.toLowerCase().split(/[\\/]/u).at(-1)?.trim() ?? "";
  const dot = basename.lastIndexOf(".");
  const extension = dot > 0 ? basename.slice(dot + 1) : "";
  const media = attachmentMediaPreview(mimeType, filename);
  if (media) return media.kind;
  if (/^image\/(png|jpeg|gif|webp)$/u.test(normalizedMime)) return "image";
  if (
    normalizedMime === "text/markdown" ||
    extension === "md" ||
    extension === "markdown"
  )
    return "markdown";
  if (
    normalizedMime === "text/x-diff" ||
    normalizedMime === "text/x-patch" ||
    extension === "diff" ||
    extension === "patch"
  )
    return "diff";
  if (
    normalizedMime === "text/csv" ||
    normalizedMime === "text/tab-separated-values" ||
    extension === "csv" ||
    extension === "tsv"
  )
    return "csv";
  if (
    normalizedMime === "text/html" ||
    extension === "html" ||
    extension === "htm"
  )
    return "html";
  if (
    normalizedMime.startsWith("text/") ||
    TEXT_PREVIEW_MIME_TYPES.has(normalizedMime) ||
    TEXT_PREVIEW_EXTENSIONS.has(extension) ||
    TEXT_PREVIEW_BASENAMES.has(basename)
  )
    return "text";
  return "unsupported";
}
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
export const WorkerArtifactPrepareRequestSchema = AttachmentSchema.pick({
  filename: true,
  mimeType: true,
  size: true,
})
  .extend({
    idempotencyKey: IdentifierSchema,
    taskId: IdentifierSchema,
  })
  .strict();
export type WorkerArtifactPrepareRequest = z.infer<
  typeof WorkerArtifactPrepareRequestSchema
>;
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
export const WorkerArtifactUploadSchema = FileUploadSchema.extend({
  sha256: AttachmentSchema.shape.sha256.optional(),
  taskId: IdentifierSchema,
}).strict();
export type WorkerArtifactUpload = z.infer<typeof WorkerArtifactUploadSchema>;
export const WorkerMessageAttachmentPrepareRequestSchema =
  WorkerArtifactPrepareRequestSchema.omit({ taskId: true })
    .extend({
      channel: WorkerReadChannelSchema.optional(),
      contextReceipt: WorkerTargetReceiptSchema.optional(),
    })
    .strict()
    .refine(
      (input) =>
        (input.channel === undefined) === (input.contextReceipt === undefined),
      { message: "channel and contextReceipt must be supplied together" },
    );
export const WorkerMessageAttachmentUploadSchema = FileUploadSchema.extend({
  sha256: AttachmentSchema.shape.sha256.optional(),
}).strict();
export type WorkerMessageAttachmentPrepareRequest = z.infer<
  typeof WorkerMessageAttachmentPrepareRequestSchema
>;
export type WorkerMessageAttachmentUpload = z.infer<
  typeof WorkerMessageAttachmentUploadSchema
>;
export const FileIdRequestSchema = z
  .object({ attachmentId: IdentifierSchema })
  .strict();
export const WorkerMessageAttachmentCancelRequestSchema = FileIdRequestSchema;
export type WorkerMessageAttachmentCancelRequest = z.infer<
  typeof WorkerMessageAttachmentCancelRequestSchema
>;
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
