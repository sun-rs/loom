import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
const RelativePath = z
  .string()
  .max(4096)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !/[\\\0]/u.test(p) &&
      !p.split("/").some((s) => s === ".." || s === "."),
  );
export const ComputerFilesListRequestSchema = z
  .object({
    hostId: IdentifierSchema.optional(),
    rootId: IdentifierSchema.optional(),
    path: RelativePath.default(""),
    includeHidden: z.boolean().optional(),
  })
  .strict();
export type ComputerFilesListRequest = z.infer<
  typeof ComputerFilesListRequestSchema
>;
export const ComputerFilesListResponseSchema = z
  .object({
    hostId: IdentifierSchema,
    label: z.string(),
    rootId: IdentifierSchema,
    roots: z
      .array(
        z
          .object({
            rootId: IdentifierSchema,
            absolutePath: z.string(),
            label: z.string(),
          })
          .strict(),
      )
      .max(32),
    path: RelativePath,
    absolutePath: z.string(),
    truncated: z.boolean(),
    entries: z
      .array(
        z
          .object({
            name: z.string(),
            path: RelativePath,
            absolutePath: z.string(),
            isDirectory: z.boolean(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type ComputerFilesListResponse = z.infer<
  typeof ComputerFilesListResponseSchema
>;
