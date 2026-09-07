export const formalBrowserAllowedApiRequests = [
  "GET /_rah/session",
  "GET /v3/client/health",
  "POST /v1/local/runtimes/list",
  "POST /v3/client/activity/list",
  "POST /v3/client/agents/list",
  "POST /v3/client/agents/get",
  "POST /v3/client/agents/presence/list",
  "POST /v3/client/humans/profile",
  "POST /v3/client/input-requests/list",
  "POST /v3/client/managed-mcp/assignments/list",
  "POST /v3/client/managed-mcp/executors/list",
  "POST /v3/client/managed-mcp/servers/list",
  "POST /v3/client/messages/list",
  "POST /v3/client/messages/reference-read-states",
  "POST /v3/client/messages/social",
  "POST /v3/client/notifications/list",
  "POST /v3/client/principals/me",
  "POST /v3/client/push/configuration",
  "POST /v3/client/rooms/agents/activity/list",
  "POST /v3/client/rooms/list",
  "POST /v3/client/rooms/members/list",
  "POST /v3/client/rooms/sync",
  "POST /v3/client/sidebar/get",
  "POST /v3/client/search",
  "POST /v3/client/tasks/global",
  "POST /v3/client/tasks/list",
  "POST /v3/client/tasks/reviews/list",
  "POST /v3/client/threads/list",
  "POST /v3/client/workspaces/list",
  "POST /v3/client/workspaces/humans",
];
const exactApiRequests = new Set(formalBrowserAllowedApiRequests);
export const formalBrowserReadStateRequests = [
  "POST /v3/client/activity/mark",
  "POST /v3/client/rooms/acknowledge",
];
const exactReadStateRequests = new Set(formalBrowserReadStateRequests);

export const requiredFormalBrowserRequests = [
  "GET /_rah/session",
  "GET /v3/client/health",
  "POST /v3/client/workspaces/list",
];

export function parseFormalBrowserTarget(environment) {
  const originValue = environment.RAH_FORMAL_ORIGIN;
  const databaseValue = environment.RAH_FORMAL_DATABASE;
  if (!originValue || !databaseValue) {
    throw new Error(
      "Formal acceptance requires explicit RAH_FORMAL_ORIGIN and RAH_FORMAL_DATABASE values",
    );
  }

  const url = new URL(originValue);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
    throw new Error("RAH_FORMAL_ORIGIN must be a loopback HTTP origin");
  }
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("RAH_FORMAL_ORIGIN must be a bare origin");
  }

  const databasePath = resolve(databaseValue);
  if (basename(databasePath) !== "room.db") {
    throw new Error("RAH_FORMAL_DATABASE must identify a room.db file");
  }
  return { databasePath, origin: url.origin };
}

export function classifyFormalBrowserRequest(input) {
  const url = new URL(input.url);
  const method = input.method.toUpperCase();
  const identity = `${method} ${url.pathname}`;
  if (url.origin !== input.origin)
    return { decision: "reject", identity, reason: "cross-origin" };
  if (exactApiRequests.has(identity))
    return { decision: "allow-api", identity };
  if (exactReadStateRequests.has(identity))
    return { decision: "allow-read-state", identity };
  if (/^\/v\d+\//u.test(url.pathname) || url.pathname.startsWith("/_rah/"))
    return { decision: "reject", identity, reason: "undeclared-api" };
  return { decision: "allow-static", identity };
}
import { basename, resolve } from "node:path";
