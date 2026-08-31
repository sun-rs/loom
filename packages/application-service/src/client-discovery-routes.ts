import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import type { ZodType } from "zod";

export const DISCOVERY_DATA_PATHS = [
  "/tasks/global",
  "/search",
  "/messages/context",
  "/activity/list",
  "/activity/mark",
  "/activity/follow",
];

// Thin adapter. Validation, authentication and errors stay on the shared HTTP path.
export function routeDiscovery(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  path: string,
  body: Record<string, unknown>,
  parse: <T>(schema: ZodType<T>, body: Record<string, unknown>) => T,
): unknown {
  switch (path) {
    case "/tasks/global":
      return P.GlobalTasksResponseSchema.parse(
        human.listGlobalTasks(actor, parse(P.GlobalTasksRequestSchema, body)),
      );
    case "/search":
      return P.WorkspaceSearchResponseSchema.parse(
        human.searchWorkspace(
          actor,
          parse(P.WorkspaceSearchRequestSchema, body),
        ),
      );
    case "/messages/context":
      return P.MessageContextResponseSchema.parse(
        human.getMessageContext(
          actor,
          parse(P.MessageContextRequestSchema, body),
        ),
      );
    case "/activity/list":
      return P.HumanActivityResponseSchema.parse(
        human.listHumanActivity(
          actor,
          parse(P.HumanActivityRequestSchema, body),
        ),
      );
    case "/activity/mark":
      return P.HumanActivityMarkResponseSchema.parse(
        human.markHumanActivity(
          actor,
          parse(P.HumanActivityMarkRequestSchema, body),
        ),
      );
    case "/activity/follow":
      return P.HumanThreadFollowResponseSchema.parse(
        human.followHumanThread(
          actor,
          parse(P.HumanThreadFollowRequestSchema, body),
        ),
      );
    default:
      return undefined;
  }
}
