import type { NavigationTarget } from "@rah-os/protocol";

import { normalizeAgentRouteTab, type AgentRouteTab } from "./agent-route.ts";
import type { GlobalSurface } from "./global-discovery-model.ts";

export type ProductNavigationRequest = {
  target: NavigationTarget;
  surface?: "activity" | "tasks";
};

export type NavigationPresentation = {
  agentDefinitionId?: string;
  agentTab?: AgentRouteTab;
  focusedMessageId?: string;
  inputRequestId?: string;
  roomId?: string;
  surface: GlobalSurface | "agents" | "computers" | "room";
  tab: "chat" | "tasks" | "files";
  threadRootMessageId?: string;
};

export function navigationPresentation(
  target: NavigationTarget,
  originSurface?: "activity" | "tasks",
): NavigationPresentation {
  if (target.kind === "agent")
    return {
      agentDefinitionId: target.agentDefinitionId,
      agentTab: normalizeAgentRouteTab(target.tab),
      surface: "agents",
      tab: "chat",
    };
  if (target.kind === "computer") return { surface: "computers", tab: "chat" };
  const common = {
    roomId: target.roomId,
    surface:
      originSurface === "activity" && retainsActivityBackground(target)
        ? ("activity" as const)
        : ("room" as const),
  };
  if (target.kind === "room") return { ...common, tab: "chat" };
  if (target.kind === "message")
    return {
      ...common,
      focusedMessageId: target.messageId,
      tab: "chat",
      ...(target.rootMessageId === undefined
        ? {}
        : { threadRootMessageId: target.rootMessageId }),
    };
  if (target.kind === "thread")
    return {
      ...common,
      tab: "chat",
      ...(target.rootMessageId === undefined
        ? {}
        : { threadRootMessageId: target.rootMessageId }),
    };
  if (target.kind === "task")
    return {
      ...common,
      ...(originSurface === "tasks"
        ? {
            surface: "tasks" as const,
            ...(target.rootMessageId === undefined
              ? {}
              : { focusedMessageId: target.rootMessageId }),
          }
        : {}),
      tab: "tasks",
      ...(target.rootMessageId === undefined
        ? {}
        : { threadRootMessageId: target.rootMessageId }),
    };
  if (target.kind === "input_request")
    return {
      ...common,
      inputRequestId: target.inputRequestId,
      tab: "chat",
    };
  return {
    ...common,
    tab: "files",
    ...(target.messageId === undefined
      ? {}
      : { focusedMessageId: target.messageId }),
  };
}

export function navigationSearch(
  request: ProductNavigationRequest,
  currentSearch = "",
): string {
  const params = new URLSearchParams();
  const { target } = request;
  if (request.surface === "tasks" && target.kind === "task") {
    params.set("surface", "tasks");
    const current = new URLSearchParams(currentSearch);
    if (current.get("surface") === "tasks")
      for (const key of ["channel", "creator", "assignee", "view"])
        for (const value of current.getAll(key)) params.append(key, value);
  }
  if (
    request.surface === "activity" &&
    retainsActivityBackground(request.target)
  ) {
    params.set("surface", "activity");
    const filter = new URLSearchParams(currentSearch).get("filter");
    if (filter === "unread" || filter === "mentions")
      params.set("filter", filter);
  }
  params.set("target", target.kind);
  if (target.kind === "agent") {
    params.set("surface", "agents");
    params.set("agent", target.agentDefinitionId);
    params.set("agentTab", normalizeAgentRouteTab(target.tab));
    return `?${params}`;
  }
  if (target.kind === "computer") {
    params.set("surface", "computers");
    params.set("computer", target.hostId);
    return `?${params}`;
  }
  params.set("room", target.roomId);
  if (target.kind === "message") {
    params.set("message", target.messageId);
    if (target.threadId) params.set("threadId", target.threadId);
    if (target.rootMessageId)
      params.set("thread", `${target.roomId}:${target.rootMessageId}`);
  } else if (target.kind === "thread") {
    params.set("threadId", target.threadId);
    if (target.rootMessageId)
      params.set("thread", `${target.roomId}:${target.rootMessageId}`);
  } else if (target.kind === "task") {
    params.set("roomTab", "tasks");
    params.set("task", target.taskId);
    if (target.threadId) params.set("threadId", target.threadId);
    if (target.rootMessageId)
      params.set("thread", `${target.roomId}:${target.rootMessageId}`);
  } else if (target.kind === "input_request") {
    params.set("inputRequest", target.inputRequestId);
  } else if (target.kind === "artifact") {
    params.set("roomTab", "files");
    params.set("artifact", target.artifactId);
    if (target.messageId) params.set("message", target.messageId);
  }
  return `?${params}`;
}

function retainsActivityBackground(target: NavigationTarget): boolean {
  return (
    target.kind === "thread" ||
    target.kind === "task" ||
    (target.kind === "message" && target.rootMessageId !== undefined)
  );
}

export function roomTabFromSearch(search: string): "chat" | "tasks" | "files" {
  const value = new URLSearchParams(search).get("roomTab");
  return value === "tasks" || value === "files" ? value : "chat";
}

export function shouldHandleClientNavigation(event: {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}
