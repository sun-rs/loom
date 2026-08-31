import { z } from "zod";

import { IdentifierSchema } from "./common.ts";

const MAX_CALL_ARGUMENT_BYTES = 64 * 1_024;
const MAX_CALL_RESULT_BYTES = 512 * 1_024;
const MAX_CATALOG_BYTES = 512 * 1_024;

const ManagedMcpNameSchema = z.string().trim().min(1).max(256);
const ManagedMcpDisplayNameSchema = z.string().trim().min(1).max(512);

export const ManagedMcpRuntimeAdapterSchema = z
  .object({
    kind: z.enum([
      "claude-cli/v1",
      "codex-cli/v1",
      "kimi-cli/v1",
      "opencode-cli/v1",
    ]),
  })
  .strict();
export type ManagedMcpRuntimeAdapter = z.infer<
  typeof ManagedMcpRuntimeAdapterSchema
>;

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function boundedJsonObject(maxBytes: number, description: string) {
  return z
    .record(z.string(), z.json())
    .refine((value) => jsonBytes(value) <= maxBytes, {
      message: `${description} exceeds ${String(maxBytes)} bytes`,
    });
}

export const ManagedMcpToolAnnotationsSchema = z
  .object({
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
    readOnlyHint: z.boolean().optional(),
  })
  .strict();
export type ManagedMcpToolAnnotations = z.infer<
  typeof ManagedMcpToolAnnotationsSchema
>;

export const ManagedMcpInputSchemaSchema = boundedJsonObject(
  MAX_CALL_ARGUMENT_BYTES,
  "managed MCP input schema",
)
  .refine((schema) => schema.type === "object", {
    message: 'managed MCP input schema type must be "object"',
    path: ["type"],
  })
  .transform(
    (schema): typeof schema & { type: "object" } =>
      schema as typeof schema & { type: "object" },
  );
export type ManagedMcpInputSchema = z.infer<typeof ManagedMcpInputSchemaSchema>;

const ManagedMcpToolDefinitionFields = {
  annotations: ManagedMcpToolAnnotationsSchema.optional(),
  description: z.string().trim().min(1).max(8_192).optional(),
  inputSchema: ManagedMcpInputSchemaSchema,
  runtimeName: ManagedMcpNameSchema,
  title: ManagedMcpDisplayNameSchema.optional(),
  toolName: ManagedMcpNameSchema,
} as const;

export const ManagedMcpToolDefinitionSchema = z
  .object(ManagedMcpToolDefinitionFields)
  .strict();
export type ManagedMcpToolDefinition = z.infer<
  typeof ManagedMcpToolDefinitionSchema
>;

export const ManagedMcpServerDefinitionSchema = z
  .object({
    executorRef: IdentifierSchema,
    runtimeName: ManagedMcpNameSchema,
    serverName: ManagedMcpDisplayNameSchema,
    tools: z.array(ManagedMcpToolDefinitionSchema).min(1).max(128),
  })
  .strict()
  .superRefine((definition, context) => {
    if (jsonBytes(definition) > MAX_CATALOG_BYTES) {
      context.addIssue({
        code: "custom",
        message: "managed MCP Server definition exceeds 512 KiB",
      });
    }
    const toolNames = new Set<string>();
    definition.tools.forEach((tool, index) => {
      if (toolNames.has(tool.toolName)) {
        context.addIssue({
          code: "custom",
          message: `duplicate toolName: ${tool.toolName}`,
          path: ["tools", index, "toolName"],
        });
      }
      toolNames.add(tool.toolName);
    });
  });
export type ManagedMcpServerDefinition = z.infer<
  typeof ManagedMcpServerDefinitionSchema
>;

export const ManagedMcpCatalogToolSchema = z
  .object({
    ...ManagedMcpToolDefinitionFields,
    assignmentVersion: z.number().int().positive(),
    configVersion: z.number().int().positive(),
    mcpServerId: IdentifierSchema,
    serverName: ManagedMcpDisplayNameSchema,
  })
  .strict();
export type ManagedMcpCatalogTool = z.infer<typeof ManagedMcpCatalogToolSchema>;

export const ManagedMcpCatalogSchema = z
  .object({
    catalogVersion: z.literal(1),
    tools: z.array(ManagedMcpCatalogToolSchema).max(512),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (jsonBytes(catalog) > MAX_CATALOG_BYTES) {
      context.addIssue({
        code: "custom",
        message: "managed MCP catalog exceeds 512 KiB",
      });
    }
    const runtimeToolNames = new Set<string>();
    catalog.tools.forEach((tool, index) => {
      const identity = JSON.stringify([tool.runtimeName, tool.toolName]);
      if (runtimeToolNames.has(identity)) {
        context.addIssue({
          code: "custom",
          message: `duplicate runtime tool: ${tool.runtimeName} / ${tool.toolName}`,
          path: ["tools", index, "toolName"],
        });
      }
      runtimeToolNames.add(identity);
    });
  });
export type ManagedMcpCatalog = z.infer<typeof ManagedMcpCatalogSchema>;

export const ManagedMcpCallRequestSchema = z
  .object({
    arguments: boundedJsonObject(
      MAX_CALL_ARGUMENT_BYTES,
      "managed MCP call arguments",
    ),
    expectedAssignmentVersion: z.number().int().positive(),
    expectedConfigVersion: z.number().int().positive(),
    mcpServerId: IdentifierSchema,
    toolName: ManagedMcpNameSchema,
  })
  .strict();
export type ManagedMcpCallRequest = z.infer<typeof ManagedMcpCallRequestSchema>;

export const ManagedMcpTextContentSchema = z
  .object({ type: z.literal("text"), text: z.string() })
  .strict();
export const ManagedMcpImageContentSchema = z
  .object({
    data: z.string(),
    mimeType: z.string().trim().min(1).max(256),
    type: z.literal("image"),
  })
  .strict();
export const ManagedMcpCallResultSchema = z
  .object({
    content: z.array(
      z.discriminatedUnion("type", [
        ManagedMcpTextContentSchema,
        ManagedMcpImageContentSchema,
      ]),
    ),
    isError: z.boolean(),
    structuredContent: boundedJsonObject(
      MAX_CALL_RESULT_BYTES,
      "managed MCP structured content",
    ).optional(),
  })
  .strict()
  .refine((result) => jsonBytes(result) <= MAX_CALL_RESULT_BYTES, {
    message: "managed MCP call result exceeds 512 KiB",
  });
export type ManagedMcpCallResult = z.infer<typeof ManagedMcpCallResultSchema>;

export const WorkerManagedMcpCatalogRequestSchema = z.object({}).strict();
export const WorkerManagedMcpCatalogResponseSchema = ManagedMcpCatalogSchema;
export const WorkerManagedMcpCallRequestSchema = ManagedMcpCallRequestSchema;
export const WorkerManagedMcpCallResponseSchema = ManagedMcpCallResultSchema;
