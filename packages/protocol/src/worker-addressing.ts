import { z } from "zod";

/** Read-only canonical identity projection, never an authority or read receipt. */
export const WorkerAddressingSchema = z
  .object({
    targets: z.record(z.string(), z.string()),
    handles: z.record(z.string(), z.string()),
  })
  .strict();
export type WorkerAddressing = z.infer<typeof WorkerAddressingSchema>;
