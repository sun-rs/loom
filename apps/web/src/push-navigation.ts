import {
  NavigationTargetSchema,
  type NavigationTarget,
} from "@rah-os/protocol";
import { navigationSearch } from "./navigation-target.ts";

export function pushTargetSearch(target: NavigationTarget) {
  return navigationSearch({ target });
}

export function acceptPushNavigationUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const target = new URL(value, window.location.origin);
  if (target.origin !== window.location.origin || target.pathname !== "/")
    return undefined;
  return `${target.pathname}${target.search}${target.hash}`;
}

export function pushTargetFromSearch(
  search: string,
): NavigationTarget | undefined {
  const params = new URLSearchParams(search);
  const kind = params.get("target");
  const roomId = params.get("room") ?? undefined;
  const value: unknown =
    kind === "agent"
      ? {
          kind,
          agentDefinitionId: params.get("agent"),
          tab: params.get("agentTab") ?? undefined,
        }
      : kind === "computer"
        ? { kind, hostId: params.get("computer") }
        : kind === "room"
          ? { kind, roomId }
          : kind === "message"
            ? {
                kind,
                roomId,
                messageId: params.get("message"),
                threadId: params.get("threadId") ?? undefined,
                rootMessageId: threadRoot(params, roomId),
              }
            : kind === "thread"
              ? {
                  kind,
                  roomId,
                  threadId: params.get("threadId"),
                  rootMessageId: threadRoot(params, roomId),
                }
              : kind === "task"
                ? {
                    kind,
                    roomId,
                    taskId: params.get("task"),
                    threadId: params.get("threadId") ?? undefined,
                    rootMessageId: threadRoot(params, roomId),
                  }
                : kind === "input_request"
                  ? {
                      kind,
                      roomId,
                      inputRequestId: params.get("inputRequest"),
                    }
                  : kind === "artifact"
                    ? {
                        kind,
                        roomId,
                        artifactId: params.get("artifact"),
                        messageId: params.get("message") ?? undefined,
                      }
                    : undefined;
  const parsed = NavigationTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function threadRoot(params: URLSearchParams, roomId: string | undefined) {
  const value = params.get("thread");
  if (!value || !roomId || !value.startsWith(`${roomId}:`)) return undefined;
  return value.slice(roomId.length + 1) || undefined;
}
