import { z } from "zod";
import { IdentifierSchema } from "./common.ts";

/** Internal Worker facade; execution identity never comes from tool arguments. */
export const WorkerReplyMcpArgumentsSchema = z
  .object({
    body: z.string().trim().min(1).max(1_000_000),
    final: z.boolean().optional(),
    basedOnRoomSeq: z.number().int().nonnegative().optional(),
    reviseDraftId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.reviseDraftId === undefined
        ? value.final === undefined
        : value.final !== undefined || value.basedOnRoomSeq !== undefined
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
    "Reply to the unique delivered conversation; Loom resolves the target from this execution. Every new reply MUST include final: true when all current work is complete, false for progress. A new reply containing only body is invalid. To revise a held draft, provide only body and reviseDraftId. Identity is bound by Loom. If delivery spans multiple targets, use the Worker CLI to select one explicitly. Other targets and attachments also use the Worker CLI.",
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string", minLength: 1, maxLength: 1_000_000 },
      final: {
        type: "boolean",
        description: "Required for a new reply; omit for a draft revision.",
      },
      basedOnRoomSeq: {
        type: "integer",
        minimum: 0,
        description:
          "For a new reply, copy the Reply context's --based-on-room-seq value here to confirm delivered context. Do not guess or use a newer message's sequence. If delivery is incomplete, use message-check first. Omit for a draft revision.",
      },
      reviseDraftId: { type: "string", minLength: 1 },
    },
    required: ["body"],
    oneOf: [
      {
        required: ["final"],
        not: { required: ["reviseDraftId"] },
      },
      {
        required: ["reviseDraftId"],
        not: {
          anyOf: [{ required: ["final"] }, { required: ["basedOnRoomSeq"] }],
        },
      },
    ],
    additionalProperties: false,
  },
} as const;
