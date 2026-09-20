import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const AgentNavigationTabSchema = z.enum([
  "activity",
  "profile",
  "chat",
  "reminders",
  "workspace",
  "apps",
  "mcp",
]);

export const NavigationTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("room"), roomId: IdentifierSchema }).strict(),
  z
    .object({
      kind: z.literal("message"),
      messageId: IdentifierSchema,
      roomId: IdentifierSchema,
      rootMessageId: IdentifierSchema.optional(),
      threadId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread"),
      roomId: IdentifierSchema,
      rootMessageId: IdentifierSchema.optional(),
      threadId: IdentifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task"),
      roomId: IdentifierSchema,
      rootMessageId: IdentifierSchema.optional(),
      taskId: IdentifierSchema,
      threadId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      inputRequestId: IdentifierSchema,
      kind: z.literal("input_request"),
      roomId: IdentifierSchema,
      taskId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      agentId: IdentifierSchema,
      kind: z.literal("agent"),
      tab: AgentNavigationTabSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("computer"), hostId: IdentifierSchema }).strict(),
  z
    .object({
      artifactId: IdentifierSchema,
      kind: z.literal("artifact"),
      messageId: IdentifierSchema.optional(),
      roomId: IdentifierSchema,
    })
    .strict(),
]);
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;

export const ClientNavigationResolveRequestSchema = z
  .object({ target: NavigationTargetSchema })
  .strict();
export type ClientNavigationResolveRequest = z.infer<
  typeof ClientNavigationResolveRequestSchema
>;
export const ClientNavigationResolveResponseSchema = z
  .object({ target: NavigationTargetSchema })
  .strict();
export type ClientNavigationResolveResponse = z.infer<
  typeof ClientNavigationResolveResponseSchema
>;

export const ClientNotificationListRequestSchema = z
  .object({ workspaceId: IdentifierSchema })
  .strict();
export type ClientNotificationListRequest = z.infer<
  typeof ClientNotificationListRequestSchema
>;

export const ComputerOfflineNotificationSchema = z
  .object({
    computerName: z.string().trim().min(1).max(200),
    dismissible: z.boolean(),
    kind: z.literal("computer_offline"),
    lastSeenAt: TimestampSchema.optional(),
    notificationId: IdentifierSchema,
    target: z
      .object({ kind: z.literal("computer"), hostId: IdentifierSchema })
      .strict(),
  })
  .strict();
export const SystemNotificationSchema = z.discriminatedUnion("kind", [
  ComputerOfflineNotificationSchema,
]);
export type SystemNotification = z.infer<typeof SystemNotificationSchema>;

export const ClientNotificationListResponseSchema = z
  .object({ notifications: z.array(SystemNotificationSchema).max(100) })
  .strict();
export type ClientNotificationListResponse = z.infer<
  typeof ClientNotificationListResponseSchema
>;

export const ClientNotificationDismissRequestSchema = z
  .object({
    idempotencyKey: IdentifierSchema,
    notificationId: IdentifierSchema,
    workspaceId: IdentifierSchema,
  })
  .strict();
export type ClientNotificationDismissRequest = z.infer<
  typeof ClientNotificationDismissRequestSchema
>;
export const ClientNotificationDismissResponseSchema = z
  .object({ notificationId: IdentifierSchema })
  .strict();
export type ClientNotificationDismissResponse = z.infer<
  typeof ClientNotificationDismissResponseSchema
>;

/** Internal Kernel preference projection; not a second notification body store. */
export const NotificationDismissalListSchema = z
  .object({ notificationIds: z.array(IdentifierSchema).max(100) })
  .strict();
export type NotificationDismissalList = z.infer<
  typeof NotificationDismissalListSchema
>;
