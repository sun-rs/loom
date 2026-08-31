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
export const AgentWorkspaceListRequestSchema = z
  .object({
    agentDefinitionId: z.string().min(1),
    path: Path.default(""),
    includeHidden: z.boolean().default(false),
  })
  .strict();
export const AgentWorkspaceReadRequestSchema = z
  .object({
    agentDefinitionId: z.string().min(1),
    path: Path.refine((p) => p.length > 0),
  })
  .strict();
export const AgentWorkspaceListSchema = z
  .object({
    rootPath: z.string(),
    rootKind: z.literal("agent-home"),
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
    path: Path,
    content: z.string().max(7_000_000).nullable(),
    encoding: z.enum(["utf-8", "base64", "binary"]),
    mimeType: z.string(),
    size: z.number().nonnegative(),
  })
  .strict();
export type AgentWorkspaceListing = z.infer<typeof AgentWorkspaceListSchema>;
export type AgentWorkspaceFile = z.infer<typeof AgentWorkspaceFileSchema>;
