import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { OFFICIAL_AGENT_AVATAR_KEYS } from "./official-agent-avatars.ts";
import { UploadedProfileImageKeySchema } from "./profile-image.ts";

export const ClientAgentProfileRequestSchema = z
  .object({
    action: z.literal("update_profile"),
    agentId: IdentifierSchema,
    expectedRevisionId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    field: z.enum(["displayName", "description", "avatarKey"]),
    avatarUploadIntentId: IdentifierSchema.optional(),
    value: z.string().trim().max(2000),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.field === "displayName" &&
      (!input.value || input.value.length > 128 || /[\r\n]/u.test(input.value))
    )
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "显示名称须为 1–128 字符的单行文本",
      });
    if (
      input.field === "avatarKey" &&
      !OFFICIAL_AGENT_AVATAR_KEYS.includes(input.value) &&
      !UploadedProfileImageKeySchema.safeParse(input.value).success
    )
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "头像须来自官方 Agent 头像库或已验证的上传图片",
      });
  });
export type ClientAgentProfileRequest = z.infer<
  typeof ClientAgentProfileRequestSchema
>;
