import { z } from "zod";

/**
 * Owner decision 2026-09-26: a Channel owns one platform-created home
 * directory (the CLI cwd of its instances) plus zero or more attached
 * directories chosen at creation. Both are immutable after creation. The
 * attached paths are Human-chosen host directories; the platform only
 * validates them and never creates or deletes them.
 */
export const CHANNEL_ATTACHED_DIRECTORY_LIMIT = 16;

export const ChannelAttachedDirectorySchema = z
  .string()
  .min(2)
  .max(4_096)
  .refine(
    (path) =>
      path.startsWith("/") &&
      !path.endsWith("/") &&
      !/[\u0000-\u001f\u007f]/u.test(path) &&
      path
        .slice(1)
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        ),
    "attached directory must be a normalized absolute path",
  );
export type ChannelAttachedDirectory = z.infer<
  typeof ChannelAttachedDirectorySchema
>;

export const ChannelAttachedDirectoriesSchema = z
  .array(ChannelAttachedDirectorySchema)
  .max(CHANNEL_ATTACHED_DIRECTORY_LIMIT)
  .refine(
    (paths) => new Set(paths).size === paths.length,
    "attached directories must be unique",
  );

export const ChannelWorkspaceSchema = z
  .object({
    kind: z.literal("channel_home"),
    additionalDirectories: ChannelAttachedDirectoriesSchema,
    // Absolute path of the primary directory, fixed at creation from the
    // then-configured channel workspace root; a later root change never
    // moves it. Absent on Channels created before it was recorded.
    primaryDirectory: ChannelAttachedDirectorySchema.optional(),
  })
  .strict();
export type ChannelWorkspace = z.infer<typeof ChannelWorkspaceSchema>;

/**
 * Host observation of the primary directory, reported by the Host that
 * prepares it (Kernel is never the filesystem owner): `pending` until a Host
 * reports, `ready` once created and verified, `failed` with a reason.
 */
export const ChannelWorkspacePrimaryStateSchema = z
  .object({
    state: z.enum(["pending", "ready", "failed"]),
    reason: z.string().min(1).max(1_000).optional(),
  })
  .strict();
export type ChannelWorkspacePrimaryState = z.infer<
  typeof ChannelWorkspacePrimaryStateSchema
>;

export const ChannelWorkspaceProjectionSchema = ChannelWorkspaceSchema.extend({
  primary: ChannelWorkspacePrimaryStateSchema.optional(),
}).strict();
export type ChannelWorkspaceProjection = z.infer<
  typeof ChannelWorkspaceProjectionSchema
>;

export const ChannelWorkspaceStateReportSchema = z
  .object({
    roomId: z.string().min(1).max(256),
    state: z.enum(["ready", "failed"]),
    reason: z.string().min(1).max(1_000).optional(),
  })
  .strict();
export type ChannelWorkspaceStateReport = z.infer<
  typeof ChannelWorkspaceStateReportSchema
>;
