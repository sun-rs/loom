import { z } from "zod";

// Local deployment lifecycle, independent from Room business mutations.
export const WorkbenchServiceRestartRequestSchema = z.strictObject({
  generation: z.string().min(1).max(128),
});
export const WorkbenchServiceStatusSchema = z.discriminatedUnion("available", [
  z.strictObject({ available: z.literal(false) }),
  z.strictObject({
    available: z.literal(true),
    generation: z.string().min(1),
    state: z.enum(["online", "restarting", "failed"]),
  }),
]);
