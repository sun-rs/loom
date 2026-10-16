import type {
  AuthenticatedActorContext,
  HumanApplicationPort,
} from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import type { ZodType } from "zod";

/** evo S6 batch A: Human administration of channel memory and its switches. */
export const MEMORY_DATA_PATHS = [
  "/memory/list",
  "/memory/read",
  "/memory/search",
  "/memory/history",
  "/memory/invalidate",
  "/memory/restore",
  "/memory/delete",
  "/memory/pin",
  "/memory/update",
  "/memory/policy/read",
  "/memory/policy/update",
];

// Thin adapter. Validation, authentication and errors stay on the shared HTTP path.
export function routeMemory(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  path: string,
  body: Record<string, unknown>,
  parse: <T>(schema: ZodType<T>, body: Record<string, unknown>) => T,
): unknown {
  switch (path) {
    case "/memory/list":
      return P.MemoryListResponseSchema.parse(
        human.listChannelMemory(
          actor,
          parse(P.ClientMemoryListRequestSchema, body),
        ),
      );
    case "/memory/read":
      return P.MemoryReadResponseSchema.parse(
        human.readChannelMemory(
          actor,
          parse(P.ClientMemoryEntryRequestSchema, body),
        ),
      );
    case "/memory/search":
      return P.MemorySearchResponseSchema.parse(
        human.searchChannelMemory(
          actor,
          parse(P.ClientMemorySearchRequestSchema, body),
        ),
      );
    case "/memory/history":
      return P.MemoryHistoryResponseSchema.parse(
        human.getChannelMemoryHistory(
          actor,
          parse(P.ClientMemoryEntryRequestSchema, body),
        ),
      );
    case "/memory/invalidate":
      return P.MemoryMutationResponseSchema.parse(
        human.invalidateChannelMemory(
          actor,
          parse(P.ClientMemoryInvalidateRequestSchema, body),
        ),
      );
    case "/memory/restore":
      return P.MemoryMutationResponseSchema.parse(
        human.restoreChannelMemory(
          actor,
          parse(P.ClientMemoryRestoreRequestSchema, body),
        ),
      );
    case "/memory/delete":
      return P.MemoryMutationResponseSchema.parse(
        human.deleteChannelMemory(
          actor,
          parse(P.ClientMemoryDeleteRequestSchema, body),
        ),
      );
    case "/memory/update":
      return P.MemoryMutationResponseSchema.parse(
        human.updateChannelMemory(
          actor,
          parse(P.ClientMemoryUpdateRequestSchema, body),
        ),
      );
    case "/memory/pin":
      return P.MemoryMutationResponseSchema.parse(
        human.pinChannelMemory(
          actor,
          parse(P.ClientMemoryPinRequestSchema, body),
        ),
      );
    case "/memory/policy/read":
      return P.MemoryPolicySchema.parse(
        human.getChannelMemoryPolicy(
          actor,
          parse(P.ClientMemoryPolicyReadRequestSchema, body),
        ),
      );
    case "/memory/policy/update":
      return P.MemoryPolicyUpdateResponseSchema.parse(
        human.updateChannelMemoryPolicy(
          actor,
          parse(P.ClientMemoryPolicyUpdateRequestSchema, body),
        ),
      );
    default:
      throw new Error(`unrouted memory path ${path}`);
  }
}
