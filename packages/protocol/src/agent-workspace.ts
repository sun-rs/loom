import { z } from "zod";
const Path = z
  .string()
  .max(4096)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !p.includes("\0") &&
      !p.split("/").some((x) => x === ".." || x === "."),
    "relative workspace path required",
  );
/**
 * `runtime-project` is the instance's execution cwd (the channel home for a
 * channel-home instance). Owner 2026-09-26: each Human-attached directory of
 * the channel is one more root-scoped root, numbered in creation order.
 */
export const AgentWorkspaceRootIdSchema = z.union([
  z.enum(["agent-workspace", "runtime-project"]),
  z.templateLiteral(["attached-project-", z.number().int().min(1).max(16)]),
]);
export const AgentWorkspaceRootKindSchema = AgentWorkspaceRootIdSchema;
export const AgentWorkspaceRootsRequestSchema = z
  .object({ agentId: z.string().min(1) })
  .strict();
const AgentWorkspaceRootSchema = z
  .object({
    label: z.string().trim().min(1).max(96),
    rootId: AgentWorkspaceRootIdSchema,
    rootKind: AgentWorkspaceRootKindSchema,
    rootPath: z.string().min(1).max(4096),
    state: z.enum(["absent", "ready"]),
  })
  .strict()
  .refine((root) => root.rootId === root.rootKind, {
    message: "workspace root id and kind must agree",
  });
export const AgentWorkspaceRootsSchema = z
  .object({
    defaultRootId: AgentWorkspaceRootIdSchema,
    roots: z.array(AgentWorkspaceRootSchema).min(1).max(18),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.roots.map((root) => root.rootId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "duplicate workspace root" });
    if (!ids.includes(value.defaultRootId))
      context.addIssue({
        code: "custom",
        message: "default workspace root is unavailable",
      });
  });
export const AgentWorkspaceListRequestSchema = z
  .object({
    agentId: z.string().min(1),
    rootId: AgentWorkspaceRootIdSchema.default("agent-workspace"),
    path: Path.default(""),
    includeHidden: z.boolean().default(false),
  })
  .strict();
export const AgentWorkspaceReadRequestSchema = z
  .object({
    agentId: z.string().min(1),
    rootId: AgentWorkspaceRootIdSchema.default("agent-workspace"),
    path: Path.refine((p) => p.length > 0),
  })
  .strict();
export const AgentWorkspaceListSchema = z
  .object({
    rootId: AgentWorkspaceRootIdSchema,
    rootLabel: z.string().trim().min(1).max(96),
    rootPath: z.string(),
    rootKind: AgentWorkspaceRootKindSchema,
    state: z.enum(["absent", "ready"]),
    path: Path,
    truncated: z.boolean(),
    entries: z
      .array(
        z
          .object({
            name: z.string(),
            path: Path,
            isDirectory: z.boolean(),
            isHidden: z.boolean(),
            size: z.number().nonnegative(),
            modifiedAt: z.string(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export const AgentWorkspaceFileSchema = z
  .object({
    rootId: AgentWorkspaceRootIdSchema,
    rootLabel: z.string().trim().min(1).max(96),
    rootKind: AgentWorkspaceRootKindSchema,
    path: Path,
    content: z.string().max(7_000_000).nullable(),
    encoding: z.enum(["utf-8", "base64", "binary"]),
    mimeType: z.string(),
    size: z.number().nonnegative(),
  })
  .strict();
export type AgentWorkspaceListing = z.infer<typeof AgentWorkspaceListSchema>;
export type AgentWorkspaceFile = z.infer<typeof AgentWorkspaceFileSchema>;
export type AgentWorkspaceRoot = z.infer<typeof AgentWorkspaceRootSchema>;
export type AgentWorkspaceRoots = z.infer<typeof AgentWorkspaceRootsSchema>;

export const AgentWorkspaceSummarySchema = z
  .object({
    rootPath: z.string().max(4096),
    state: z.enum(["absent", "ready"]),
    fileCount: z.number().int().nonnegative(),
    totalSizeBytes: z.number().nonnegative(),
    lastModified: z.string().nullable(),
    truncated: z.boolean(),
  })
  .strict();
export type AgentWorkspaceSummary = z.infer<typeof AgentWorkspaceSummarySchema>;
