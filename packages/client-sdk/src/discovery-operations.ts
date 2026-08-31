import * as P from "@rah-os/protocol";
import type { z } from "zod";

export const discoveryOperations = {
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
} as const;
export type DiscoveryOperationMap = {
  [K in keyof typeof discoveryOperations]: {
    input: z.infer<(typeof discoveryOperations)[K]["input"]>;
    output: z.infer<(typeof discoveryOperations)[K]["output"]>;
  };
};
