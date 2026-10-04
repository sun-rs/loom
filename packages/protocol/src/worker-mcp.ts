import { z } from "zod";
import { IdentifierSchema } from "./common.ts";

/** Internal Worker facade; execution identity never comes from tool arguments. */
export const WorkerReplyMcpArgumentsSchema = z
  .object({
    body: z.string().trim().min(1).max(1_000_000),
    final: z.boolean().optional(),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    threadId: IdentifierSchema.nullable().optional(),
    reviseDraftId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.reviseDraftId === undefined
        ? value.final === undefined
        : value.final !== undefined ||
          value.basedOnRoomSeq !== undefined ||
          value.threadId !== undefined
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A new reply requires final; a revision accepts only body and reviseDraftId and preserves saved intent.",
      });
  });

export const WORKER_REPLY_MCP_TOOL = {
  name: "loom_reply",
  description:
    "Publish a reply to the delivered conversation. Set final=true only when all current work is complete; false for progress. To revise a held draft, provide only body and reviseDraftId. Identity is bound by Loom. Other targets and attachments use the Worker CLI.",
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string", minLength: 1, maxLength: 1_000_000 },
      final: {
        type: "boolean",
        description: "Required for a new reply; omit for a draft revision.",
      },
      basedOnRoomSeq: { type: "integer", minimum: 0 },
      threadId: { type: ["string", "null"] },
      reviseDraftId: { type: "string" },
    },
    required: ["body"],
    additionalProperties: false,
  },
} as const;
