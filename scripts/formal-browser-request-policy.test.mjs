import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";

const origin = "http://127.0.0.1:4173";
const classify = (method, path) =>
  classifyFormalBrowserRequest({
    method,
    origin,
    url: new URL(path, origin).href,
  });

test("formal browser policy separates projections from read-state writes", () => {
  assert.deepEqual(classify("GET", "/_rah/session"), {
    decision: "allow-api",
    identity: "GET /_rah/session",
  });
  assert.deepEqual(classify("GET", "/v3/client/health"), {
    decision: "allow-api",
    identity: "GET /v3/client/health",
  });
  assert.deepEqual(classify("POST", "/v3/client/workspaces/list"), {
    decision: "allow-api",
    identity: "POST /v3/client/workspaces/list",
  });
  assert.deepEqual(
    classify("POST", "/v3/client/messages/reference-read-states"),
    {
      decision: "allow-api",
      identity: "POST /v3/client/messages/reference-read-states",
    },
  );
  assert.deepEqual(classify("POST", "/v3/client/search"), {
    decision: "allow-api",
    identity: "POST /v3/client/search",
  });
  assert.deepEqual(classify("POST", "/v3/client/tasks/global"), {
    decision: "allow-api",
    identity: "POST /v3/client/tasks/global",
  });
  assert.deepEqual(classify("POST", "/v3/client/messages/social"), {
    decision: "allow-api",
    identity: "POST /v3/client/messages/social",
  });
  assert.deepEqual(classify("POST", "/v3/client/activity/mark"), {
    decision: "allow-read-state",
    identity: "POST /v3/client/activity/mark",
  });
  assert.deepEqual(classify("POST", "/v3/client/rooms/acknowledge"), {
    decision: "allow-read-state",
    identity: "POST /v3/client/rooms/acknowledge",
  });
  assert.equal(classify("GET", "/assets/app.js").decision, "allow-static");
});

test("formal browser policy fails closed for undeclared versions and local routes", () => {
  for (const [method, path] of [
    ["POST", "/v2/client/workspaces/list"],
    ["POST", "/_rah/session"],
    ["GET", "/_rah/devices"],
    ["GET", "/v3/client/workspaces/list"],
    ["GET", "/v3/client/health/extra"],
    ["POST", "/v3/client/messages/react"],
    ["POST", "/v3/client/messages/save"],
    ["POST", "/v3/client/activity/follow"],
  ]) {
    assert.equal(
      classify(method, path).decision,
      "reject",
      `${method} ${path}`,
    );
  }
});

test("formal browser policy fails closed for cross-origin network access", () => {
  assert.equal(
    classifyFormalBrowserRequest({
      method: "GET",
      origin,
      url: "https://example.invalid/asset.js",
    }).decision,
    "reject",
  );
});

test("formal browser target requires an explicit loopback origin and database", () => {
  assert.throws(
    () => parseFormalBrowserTarget({}),
    /RAH_FORMAL_ORIGIN and RAH_FORMAL_DATABASE/u,
  );
  assert.throws(
    () =>
      parseFormalBrowserTarget({
        RAH_FORMAL_ORIGIN: "https://example.invalid",
        RAH_FORMAL_DATABASE: "/tmp/room.db",
      }),
    /loopback HTTP origin/u,
  );
  assert.throws(
    () =>
      parseFormalBrowserTarget({
        RAH_FORMAL_ORIGIN: "http://127.0.0.1:4173/path",
        RAH_FORMAL_DATABASE: "/tmp/room.db",
      }),
    /bare origin/u,
  );
  assert.throws(
    () =>
      parseFormalBrowserTarget({
        RAH_FORMAL_ORIGIN: "http://127.0.0.1:4173",
        RAH_FORMAL_DATABASE: "/tmp/not-production.sqlite",
      }),
    /room.db/u,
  );
});

test("formal browser target normalizes an explicitly authorized local target", () => {
  assert.deepEqual(
    parseFormalBrowserTarget({
      RAH_FORMAL_ORIGIN: "http://localhost:4173",
      RAH_FORMAL_DATABASE: "/tmp/rah/state/../state/room.db",
    }),
    {
      databasePath: "/tmp/rah/state/room.db",
      origin: "http://localhost:4173",
    },
  );
});
