import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import type { ZodType } from "zod";

export const DISCOVERY_DATA_PATHS = [
  "/messages/social",
  "/messages/react",
  "/messages/save",
  "/messages/saved",
  "/sidebar/get",
  "/sidebar/patch",
  "/tasks/global",
  "/search",
  "/messages/context",
  "/activity/list",
  "/activity/mark",
  "/activity/follow",
  "/activity/thread-followers",
  "/activity/thread-followers/remove",
  "/activity/thread-followers/restore",
  "/navigation/resolve",
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
    case "/messages/social":
      return P.MessageSocialResponseSchema.parse(
        human.listMessageSocial(
          actor,
          parse(P.MessageSocialRequestSchema, body),
        ),
      );
    case "/messages/react":
      return P.MessageSocialItemSchema.parse(
        human.reactMessage(actor, parse(P.MessageReactionRequestSchema, body)),
      );
    case "/messages/save":
      return P.MessageSocialItemSchema.parse(
        human.saveMessage(actor, parse(P.MessageSaveRequestSchema, body)),
      );
    case "/messages/saved":
      return P.SavedMessagesResponseSchema.parse(
        human.listSavedMessages(
          actor,
          parse(P.SavedMessagesRequestSchema, body),
        ),
      );
    case "/sidebar/get":
      return P.SidebarResponseSchema.parse(
        human.getSidebarPreferences(
          actor,
          parse(P.SidebarGetRequestSchema, body),
        ),
      );
    case "/sidebar/patch":
      return P.SidebarResponseSchema.parse(
        human.patchSidebarPreferences(
          actor,
          parse(P.SidebarPatchRequestSchema, body),
        ),
      );
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
    case "/activity/thread-followers":
      return P.HumanThreadFollowersResponseSchema.parse(
        human.getHumanThreadFollowers(
          actor,
          parse(P.HumanThreadFollowersRequestSchema, body),
        ),
      );
    case "/activity/thread-followers/remove":
      return P.HumanThreadFollowerRemoveResponseSchema.parse(
        human.removeHumanThreadAgentFollower(
          actor,
          parse(P.HumanThreadFollowerRemoveRequestSchema, body),
        ),
      );
    case "/activity/thread-followers/restore":
      return P.HumanThreadFollowerRestoreResponseSchema.parse(
        human.restoreHumanThreadAgentFollower(
          actor,
          parse(P.HumanThreadFollowerRestoreRequestSchema, body),
        ),
      );
    case "/navigation/resolve":
      return P.ClientNavigationResolveResponseSchema.parse(
        human.resolveNavigationTarget(
          actor,
          parse(P.ClientNavigationResolveRequestSchema, body),
        ),
      );
    default:
      return undefined;
  }
}
