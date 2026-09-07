import { join } from "node:path";
import { z } from "zod";
import {
  ManagedMcpExecutorConfigSchema,
  type ManagedMcpExecutorConfig,
} from "./config.ts";
import { FileSecretProvider } from "./secret-provider.ts";

const schema = z
  .object({
    schemaVersion: z.literal(1),
    executors: z.array(ManagedMcpExecutorConfigSchema).max(64),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.executors.map((item) => item.executorRef)).size ===
      value.executors.length,
  );

/** Local composition input only; catalog/assignments remain canonical Kernel state. */
export async function readLocalWorkbenchMcpConfig(
  stateDirectory: string,
): Promise<ManagedMcpExecutorConfig[]> {
  let contents: string;
  try {
    contents = await new FileSecretProvider().load({
      source: "file",
      path: join(stateDirectory, "managed-mcp.json"),
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw new Error(
      "Cannot read owner-private managed-mcp.json (maximum 64 KiB)",
    );
  }
  try {
    return schema.parse(JSON.parse(contents)).executors;
  } catch {
    throw new Error(
      "Invalid managed-mcp.json: use schemaVersion 1, unique executor references and supported transports; credentials must be file references",
    );
  }
}
