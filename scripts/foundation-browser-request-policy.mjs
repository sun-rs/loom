import {
  formalBrowserAllowedApiRequests,
  formalBrowserReadStateRequests,
} from "./formal-browser-request-policy.mjs";

const fixtureApiRequests = new Set([
  ...formalBrowserAllowedApiRequests,
  ...formalBrowserReadStateRequests,
  "POST /v3/client/agents/activity/list",
  "POST /v3/client/agents/get",
  "POST /v3/client/agents/manage",
  "POST /v3/client/agents/memory/config/get",
  "POST /v3/client/agents/memory/get",
  "POST /v3/client/agents/reminders/list",
  "POST /v3/client/agents/rooms/list",
  "POST /v3/client/agents/trajectory/list",
  "POST /v3/client/agents/workspace/list",
  "POST /v3/client/agents/workspace/roots",
  "POST /v3/client/activity/follow",
  "POST /v3/client/activity/thread-followers",
  "POST /v3/client/computers/profile/update",
  "POST /v3/client/files/list",
  "POST /v3/client/humans/profile",
  "POST /v3/client/messages/post",
  "POST /v3/client/messages/react",
  "POST /v3/client/messages/save",
  "POST /v3/client/messages/saved",
  "POST /v3/client/messages/social",
  "POST /v3/client/navigation/resolve",
  "POST /v3/client/principals/update",
  "POST /v3/client/rooms/direct/open",
  "POST /v3/client/search",
  "POST /v3/client/tasks/global",
  "POST /v3/client/tasks/create",
  "POST /v3/client/tasks/get",
  "POST /v3/client/tasks/workflow",
  "POST /v3/client/threads/create",
  "POST /v3/client/workspaces/member-graph",
  "POST /v3/client/workspaces/humans",
  "POST /v3/client/workspaces/update",
  "PUT /v3/client/profile-images/content",
]);

export const requiredFoundationFixtureRequests = [
  "GET /_rah/session",
  "GET /v3/client/health",
  "POST /v3/client/workspaces/list",
];

export function classifyFoundationBrowserRequest(input) {
  const url = new URL(input.url);
  const method = input.method.toUpperCase();
  const identity = `${method} ${url.pathname}`;
  if (url.origin !== input.harnessOrigin && url.origin !== input.fixtureOrigin)
    return { decision: "reject", identity, reason: "unexpected-origin" };
  const apiLike =
    /^\/v\d+\//u.test(url.pathname) || url.pathname.startsWith("/_rah/");
  if (!apiLike) return { decision: "allow-static", identity };
  if (url.origin !== input.fixtureOrigin)
    return { decision: "reject", identity, reason: "api-on-static-harness" };
  if (
    fixtureApiRequests.has(identity) ||
    (method === "GET" &&
      /^\/v3\/client\/profile-images\/content\/[a-z0-9_-]{1,64}$/u.test(
        url.pathname,
      ))
  )
    return { decision: "allow-api", identity };
  return { decision: "reject", identity, reason: "undeclared-fixture-api" };
}
