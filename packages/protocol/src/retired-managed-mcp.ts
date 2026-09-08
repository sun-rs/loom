import { z } from "zod";

/** Historical RuntimeProfile revision compatibility only; never a launch capability. */
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
