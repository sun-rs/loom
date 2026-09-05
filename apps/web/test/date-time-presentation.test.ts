import assert from "node:assert/strict";
import test from "node:test";

import { formatRahDateTime } from "../src/date-time-presentation.ts";
import { readUiSource as read } from "./ui-source.ts";

test("one date-time owner applies the selected 12 or 24 hour format", () => {
  const value = "2026-09-05T13:07:09.000Z";
  const options = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  } as const;
  assert.match(formatRahDateTime(value, options, "12", "en-US"), /01:07:09/u);
  assert.match(formatRahDateTime(value, options, "24", "en-GB"), /13:07:09/u);
  assert.equal(formatRahDateTime("not-a-date", options, "24"), "not-a-date");
});

test("time-bearing Settings consumers use the shared date-time owner", () => {
  for (const file of [
    "components/agent-directory-pane.tsx",
    "components/agent-message-identity.tsx",
    "components/conversation-panes.tsx",
    "components/forwarded-message-bundle.tsx",
    "components/global-discovery.tsx",
    "components/human-inbox.tsx",
    "components/lan-device-settings.tsx",
    "components/room-files.tsx",
    "components/workspace-catalog-panes.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /formatRahDateTime/u, file);
    assert.doesNotMatch(source, /hour12:\s*(?:false|true)/u, file);
  }
});
