import assert from "node:assert/strict";
import test from "node:test";

import { classifyFoundationBrowserRequest } from "./foundation-browser-request-policy.mjs";

const harnessOrigin = "http://127.0.0.1:4100";
const fixtureOrigin = "http://127.0.0.1:4200";
const classify = (origin, method, path) =>
  classifyFoundationBrowserRequest({
    fixtureOrigin,
    harnessOrigin,
    method,
    url: new URL(path, origin).href,
  });

test("foundation policy rejects every API route on the static harness", () => {
  assert.equal(
    classify(harnessOrigin, "POST", "/v3/client/workspaces/list").decision,
    "reject",
  );
  assert.equal(
    classify(harnessOrigin, "POST", "/v2/client/workspaces/list").decision,
    "reject",
  );
  assert.equal(
    classify(harnessOrigin, "GET", "/_rah/session").decision,
    "reject",
  );
});

test("foundation policy allows only declared fixture API requests", () => {
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/workspaces/list").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/principals/update").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/workspaces/humans").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/messages/social").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/messages/react").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/messages/save").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/rooms/direct/open").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/activity/mark").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/files/list").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/agents/manage").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/messages/saved").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/tasks/get").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "GET", "/_rah/session").decision,
    "allow-api",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v2/client/workspaces/list").decision,
    "reject",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/_rah/session").decision,
    "reject",
  );
  assert.equal(
    classify(fixtureOrigin, "POST", "/v3/client/rooms/delete").decision,
    "reject",
  );
});

test("foundation policy permits local static assets and rejects other origins", () => {
  assert.equal(
    classify(harnessOrigin, "GET", "/assets/app.js").decision,
    "allow-static",
  );
  assert.equal(
    classify(fixtureOrigin, "GET", "/assets/app.js").decision,
    "allow-static",
  );
  assert.equal(
    classifyFoundationBrowserRequest({
      fixtureOrigin,
      harnessOrigin,
      method: "GET",
      url: "https://example.invalid/a.js",
    }).decision,
    "reject",
  );
});
