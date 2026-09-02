import * as P from "@rah-os/protocol";
import type { z } from "zod";

export const discoveryOperations = {
  "message.social": {
    input: P.MessageSocialRequestSchema,
    output: P.MessageSocialResponseSchema,
    path: "/v3/client/messages/social",
    authenticated: true,
    method: "POST",
  },
  "message.react": {
    input: P.MessageReactionRequestSchema,
    output: P.MessageSocialItemSchema,
    path: "/v3/client/messages/react",
    authenticated: true,
    method: "POST",
  },
  "message.save": {
    input: P.MessageSaveRequestSchema,
    output: P.MessageSocialItemSchema,
    path: "/v3/client/messages/save",
    authenticated: true,
    method: "POST",
  },
  "message.saved": {
    input: P.SavedMessagesRequestSchema,
    output: P.SavedMessagesResponseSchema,
    path: "/v3/client/messages/saved",
    authenticated: true,
    method: "POST",
  },
  "sidebar.get": {
    input: P.SidebarGetRequestSchema,
    output: P.SidebarResponseSchema,
    path: "/v3/client/sidebar/get",
    authenticated: true,
    method: "POST",
  },
  "sidebar.patch": {
    input: P.SidebarPatchRequestSchema,
    output: P.SidebarResponseSchema,
    path: "/v3/client/sidebar/patch",
    authenticated: true,
    method: "POST",
  },
  "task.global.list": {
    input: P.GlobalTasksRequestSchema,
    output: P.GlobalTasksResponseSchema,
    path: "/v3/client/tasks/global",
    authenticated: true,
    method: "POST",
  },
  search: {
    input: P.WorkspaceSearchRequestSchema,
    output: P.WorkspaceSearchResponseSchema,
    path: "/v3/client/search",
    authenticated: true,
    method: "POST",
  },
  "message.context": {
    input: P.MessageContextRequestSchema,
    output: P.MessageContextResponseSchema,
    path: "/v3/client/messages/context",
    authenticated: true,
    method: "POST",
  },
  "activity.list": {
    input: P.HumanActivityRequestSchema,
    output: P.HumanActivityResponseSchema,
    path: "/v3/client/activity/list",
    authenticated: true,
    method: "POST",
  },
  "activity.mark": {
    input: P.HumanActivityMarkRequestSchema,
    output: P.HumanActivityMarkResponseSchema,
    path: "/v3/client/activity/mark",
    authenticated: true,
    method: "POST",
  },
  "activity.follow": {
    input: P.HumanThreadFollowRequestSchema,
    output: P.HumanThreadFollowResponseSchema,
    path: "/v3/client/activity/follow",
    authenticated: true,
    method: "POST",
  },
  "navigation.resolve": {
    input: P.ClientNavigationResolveRequestSchema,
    output: P.ClientNavigationResolveResponseSchema,
    path: "/v3/client/navigation/resolve",
    authenticated: true,
    method: "POST",
  },
  "notification.list": {
    input: P.ClientNotificationListRequestSchema,
    output: P.ClientNotificationListResponseSchema,
    path: "/v3/client/notifications/list",
    authenticated: true,
    method: "POST",
  },
  "notification.dismiss": {
    input: P.ClientNotificationDismissRequestSchema,
    output: P.ClientNotificationDismissResponseSchema,
    path: "/v3/client/notifications/dismiss",
    authenticated: true,
    method: "POST",
  },
  "push.configuration": {
    input: P.ClientPushConfigurationRequestSchema,
    output: P.ClientPushConfigurationResponseSchema,
    path: "/v3/client/push/configuration",
    authenticated: true,
    method: "POST",
  },
  "push.subscribe": {
    input: P.ClientPushSubscribeRequestSchema,
    output: P.ClientPushSubscribeResponseSchema,
    path: "/v3/client/push/subscribe",
    authenticated: true,
    method: "POST",
  },
  "push.unsubscribe": {
    input: P.ClientPushUnsubscribeRequestSchema,
    output: P.ClientPushUnsubscribeResponseSchema,
    path: "/v3/client/push/unsubscribe",
    authenticated: true,
    method: "POST",
  },
  "push.test": {
    input: P.ClientPushTestRequestSchema,
    output: P.ClientPushTestResponseSchema,
    path: "/v3/client/push/test",
    authenticated: true,
    method: "POST",
  },
} as const;
export type DiscoveryOperationMap = {
  [K in keyof typeof discoveryOperations]: {
    input: z.infer<(typeof discoveryOperations)[K]["input"]>;
    output: z.infer<(typeof discoveryOperations)[K]["output"]>;
  };
};
