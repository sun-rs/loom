import { z } from "zod";
import { ContentDigestSchema } from "./common.ts";

const ProjectKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
const AbsoluteDirectorySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !/[\u0000-\u001f\u007f]/u.test(value) &&
      !value.split("/").some((part) => part === "." || part === ".."),
    "expected a POSIX absolute directory without traversal",
  );
export const AgentMemoryProjectHintSchema = z
  .object({
    key: ProjectKeySchema,
    label: z
      .string()
      .trim()
      .min(1)
      .max(96)
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <= 96 &&
          !/[\u0000-\u001f\u007f]/u.test(value),
        "project label must be one short line (96 UTF-8 bytes)",
      ),
  })
  .strict();
export type AgentMemoryProjectHint = z.infer<
  typeof AgentMemoryProjectHintSchema
>;

export const AgentMemoryProjectCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    projects: z
      .array(
        AgentMemoryProjectHintSchema.extend({
          roots: z
            .array(
              AbsoluteDirectorySchema.refine(
                (value) => value !== "/",
                "filesystem root is not a project binding",
              ),
            )
            .min(1)
            .max(16),
          relatedKeys: z.array(ProjectKeySchema).max(8).default([]),
        }).strict(),
      )
      .max(128),
  })
  .strict()
  .superRefine((catalog, context) => {
    const keys = new Set<string>();
    const roots = new Set<string>();
    for (const project of catalog.projects) {
      if (keys.has(project.key))
        context.addIssue({ code: "custom", message: "duplicate project key" });
      keys.add(project.key);
      for (const root of project.roots) {
        if (roots.has(root))
          context.addIssue({
            code: "custom",
            message: "duplicate or ambiguous project root",
          });
        roots.add(root);
      }
    }
    for (const project of catalog.projects) {
      const seen = new Set<string>();
      for (const related of project.relatedKeys) {
        if (!keys.has(related) || related === project.key || seen.has(related))
          context.addIssue({
            code: "custom",
            message:
              "project relation must name a distinct existing project once",
          });
        seen.add(related);
      }
    }
  });
export type AgentMemoryProjectCatalog = z.infer<
  typeof AgentMemoryProjectCatalogSchema
>;

const SourceBase = z.object({
  cwd: AbsoluteDirectorySchema,
  realCwd: AbsoluteDirectorySchema,
});
export const AgentMemoryRunSourceSchema = z.discriminatedUnion("resolution", [
  SourceBase.extend({ resolution: z.literal("unconfigured") }).strict(),
  SourceBase.extend({
    resolution: z.literal("unavailable"),
    reason: z.literal("invalid_or_unavailable_catalog"),
  }).strict(),
  SourceBase.extend({
    resolution: z.literal("unmatched"),
    catalogDigest: ContentDigestSchema,
  }).strict(),
  SourceBase.extend({
    resolution: z.literal("matched"),
    catalogDigest: ContentDigestSchema,
    matchedRoot: AbsoluteDirectorySchema,
    project: AgentMemoryProjectHintSchema,
    relatedKeys: z.array(ProjectKeySchema).max(8),
  }).strict(),
]);
export type AgentMemoryRunSource = z.infer<typeof AgentMemoryRunSourceSchema>;
