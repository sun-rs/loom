import { z } from "zod";

import { NavigationTargetSchema } from "./client-navigation.ts";

const Base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+={0,2}$/u)
  .max(4096);
const PushEndpointSchema = z
  .url()
  .max(4096)
  .refine((value) => new URL(value).protocol === "https:", {
    message: "Web Push endpoints must use HTTPS",
  });

export const ClientPushSubscriptionSchema = z
  .object({
    endpoint: PushEndpointSchema,
    keys: z
      .object({
        auth: Base64UrlSchema,
        p256dh: Base64UrlSchema,
      })
      .strict(),
  })
  .strict();

export const ClientPushConfigurationRequestSchema = z
  .object({ endpoint: PushEndpointSchema.optional() })
  .strict();
export const ClientPushConfigurationResponseSchema = z
  .object({
    subscribed: z.boolean().optional(),
    applicationServerKey: Base64UrlSchema,
    subscriptionCount: z.number().int().nonnegative(),
    supported: z.boolean(),
  })
  .strict();
export const ClientPushSubscribeRequestSchema = z
  .object({ subscription: ClientPushSubscriptionSchema })
  .strict();
export const ClientPushSubscribeResponseSchema = z
  .object({
    subscribed: z.literal(true),
    subscriptionCount: z.number().int().positive(),
  })
  .strict();
export const ClientPushUnsubscribeRequestSchema = z
  .object({ endpoint: PushEndpointSchema })
  .strict();
export const ClientPushUnsubscribeResponseSchema = z
  .object({
    subscribed: z.literal(false),
    subscriptionCount: z.number().int().nonnegative(),
  })
  .strict();
export const ClientPushTestRequestSchema = z
  .object({ target: NavigationTargetSchema.optional() })
  .strict();
export const ClientPushTestResponseSchema = z
  .object({ delivered: z.number().int().nonnegative() })
  .strict();

export const WebPushPayloadSchema = z
  .object({
    alwaysShow: z.boolean().optional(),
    body: z.string().max(1000),
    notificationId: z.string().min(1).max(300),
    tag: z.string().min(1).max(300),
    target: NavigationTargetSchema,
    title: z.string().min(1).max(200),
    version: z.literal(1),
  })
  .strict();

export type ClientPushSubscription = z.infer<
  typeof ClientPushSubscriptionSchema
>;
export type ClientPushConfigurationResponse = z.infer<
  typeof ClientPushConfigurationResponseSchema
>;
export type ClientPushSubscribeRequest = z.infer<
  typeof ClientPushSubscribeRequestSchema
>;
export type ClientPushUnsubscribeRequest = z.infer<
  typeof ClientPushUnsubscribeRequestSchema
>;
export type WebPushPayload = z.infer<typeof WebPushPayloadSchema>;

/** Read-only bounded transport projection; cursor never acknowledges Room activity. */
export const ClientLocalNotificationRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    after: z.number().int().nonnegative().optional(),
  })
  .strict();
export const ClientLocalNotificationResponseSchema = z
  .object({
    cursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    notifications: z.array(WebPushPayloadSchema).max(100),
  })
  .strict();
export type ClientLocalNotificationRequest = z.infer<
  typeof ClientLocalNotificationRequestSchema
>;
