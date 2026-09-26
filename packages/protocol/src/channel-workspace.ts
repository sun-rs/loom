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
  })
  .strict();
export type ChannelWorkspace = z.infer<typeof ChannelWorkspaceSchema>;
