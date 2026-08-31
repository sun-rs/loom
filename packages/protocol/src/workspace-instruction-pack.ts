import { z } from "zod";

export const WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION = 1;
export const WORKSPACE_INSTRUCTION_PACK_MAX_FILES = 64;
export const WORKSPACE_INSTRUCTION_PACK_MAX_PATH_BYTES = 512;
export const WORKSPACE_INSTRUCTION_PACK_MAX_FILE_BYTES = 64 * 1_024;
export const WORKSPACE_INSTRUCTION_PACK_MAX_BYTES = 256 * 1_024;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const WorkspaceInstructionPackFileSchema = z
  .object({
    content: z.string().min(1),
    relativePath: z.string().min(1),
    sha256: Sha256HexSchema,
    size: z
      .number()
      .int()
      .positive()
      .max(WORKSPACE_INSTRUCTION_PACK_MAX_FILE_BYTES),
  })
  .strict()
  .superRefine((file, context) => {
    if (!isWorkspaceInstructionPackPath(file.relativePath)) {
      context.addIssue({
        code: "custom",
        message: "workspace instruction pack path is outside the allowed scope",
        path: ["relativePath"],
      });
    }
    if (utf8Bytes(file.content) !== file.size) {
      context.addIssue({
        code: "custom",
        message: "workspace instruction pack file size does not match content",
        path: ["size"],
      });
    }
  });
export type WorkspaceInstructionPackFile = z.infer<
  typeof WorkspaceInstructionPackFileSchema
>;

export const WorkspaceInstructionPackSchema = z
  .object({
    files: z
      .array(WorkspaceInstructionPackFileSchema)
      .min(1)
      .max(WORKSPACE_INSTRUCTION_PACK_MAX_FILES),
    packId: Sha256HexSchema,
    protocolVersion: z.literal(WORKSPACE_INSTRUCTION_PACK_PROTOCOL_VERSION),
  })
  .strict()
  .superRefine((pack, context) => {
    const paths = new Set<string>();
    let totalBytes = 0;
    for (const [index, file] of pack.files.entries()) {
      if (paths.has(file.relativePath)) {
        context.addIssue({
          code: "custom",
          message: "workspace instruction pack contains a duplicate path",
          path: ["files", index, "relativePath"],
        });
      }
      paths.add(file.relativePath);
      totalBytes += file.size;
    }
    if (!paths.has("AGENTS.md") || !paths.has("CLAUDE.md")) {
      context.addIssue({
        code: "custom",
        message: "workspace instruction pack requires AGENTS.md and CLAUDE.md",
        path: ["files"],
      });
    }
    if (totalBytes > WORKSPACE_INSTRUCTION_PACK_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        message: "workspace instruction pack exceeds the total byte limit",
        path: ["files"],
      });
    }
  });
export type WorkspaceInstructionPack = z.infer<
  typeof WorkspaceInstructionPackSchema
>;

export function isWorkspaceInstructionPackPath(relativePath: string): boolean {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    utf8Bytes(relativePath) > WORKSPACE_INSTRUCTION_PACK_MAX_PATH_BYTES ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        utf8Bytes(segment) > 255,
    )
  ) {
    return false;
  }
  if (relativePath === "AGENTS.md" || relativePath === "CLAUDE.md") {
    return true;
  }
  return (
    (relativePath.startsWith(".agents/skills/") ||
      relativePath.startsWith(".claude/skills/")) &&
    relativePath.endsWith(".md")
  );
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
