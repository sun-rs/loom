import assert from "node:assert/strict";
import test from "node:test";

import { parseFixtureAnnouncement } from "../../../scripts/real-browser-gate-support.mjs";

test("parseFixtureAnnouncement returns only the public browser fixture descriptor", () => {
  const descriptor = parseFixtureAnnouncement(
    [
      "vite ready",
      'RAH_MULTI_AGENT_FIXTURE {"daemonOrigin":"http://127.0.0.1:5100","lanOrigins":[],"listenHost":"127.0.0.1","roomId":"room-1","webOrigin":"http://127.0.0.1:4174","workspaceId":"workspace-1"}',
      "",
    ].join("\n"),
  );

  assert.deepEqual(descriptor, {
    daemonOrigin: "http://127.0.0.1:5100",
    lanOrigins: [],
    listenHost: "127.0.0.1",
    roomId: "room-1",
    webOrigin: "http://127.0.0.1:4174",
    workspaceId: "workspace-1",
  });
  assert.equal("accessToken" in descriptor, false);
});

test("parseFixtureAnnouncement rejects missing and malformed announcements", () => {
  assert.throws(
    () => parseFixtureAnnouncement("vite ready\n"),
    /fixture announcement is missing/u,
  );
  assert.throws(
    () => parseFixtureAnnouncement("RAH_MULTI_AGENT_FIXTURE not-json\n"),
    /fixture announcement is malformed/u,
  );
});
