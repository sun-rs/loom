import assert from "node:assert/strict";
import test from "node:test";
import { OpenCodeEventIdentityFilter } from "../src/opencode-event-identity.js";

const message = (id: string, role: string, sessionID = "s") => ({
  type: "message.updated",
  properties: { info: { id, role, sessionID } },
});
const part = (messageID: string, text: string, sessionID = "s") => ({
  type: "message.part.updated",
  properties: {
    part: { id: `p-${messageID}`, type: "text", messageID, sessionID, text },
  },
});
const busy = {
  type: "session.status",
  properties: { sessionID: "s", status: { type: "busy" } },
};

test("OpenCode projection requires assistant identity, including nested native envelopes", () => {
  const filter = new OpenCodeEventIdentityFilter();
  assert.deepEqual(
    filter.accept(part("human", "PRIVATE START PROMPT"), "s"),
    [],
  );
  assert.deepEqual(filter.accept(message("human", "user"), "s"), []);
  assert.deepEqual(
    filter.accept(part("human", "PRIVATE RESUME PROMPT"), "s"),
    [],
  );
  assert.deepEqual(filter.accept(part("assistant", "result"), "s"), []);
  const released = filter.accept(message("assistant", "assistant"), "s");
  assert.equal(released.length, 1);
  assert.equal(released[0]?.properties.sessionID, "s");
  assert.match(JSON.stringify(released), /result/);
  assert.deepEqual(
    filter.accept(message("foreign", "assistant", "other"), "s"),
    [],
  );
  assert.deepEqual(filter.accept(part("foreign", "FOREIGN", "other"), "s"), []);
  assert.deepEqual(
    filter.accept(
      {
        ...part("assistant", "conflict"),
        properties: {
          ...part("assistant", "conflict").properties,
          sessionID: "other",
        },
      },
      "s",
    ),
    [],
  );
});

test("OpenCode status duplicates collapse across productive events, but not real transitions", () => {
  const filter = new OpenCodeEventIdentityFilter();
  assert.equal(filter.accept(busy, "s").length, 1);
  assert.deepEqual(filter.accept(busy, "s"), []);
  filter.accept(message("a", "assistant"), "s");
  assert.equal(filter.accept(part("a", "reply"), "s").length, 1);
  assert.deepEqual(filter.accept(busy, "s"), []);
  assert.equal(
    filter.accept({ type: "session.idle", properties: { sessionID: "s" } }, "s")
      .length,
    1,
  );
  assert.equal(filter.accept(busy, "s").length, 1);
});

test("unknown-role buffering is bounded and never survives a session change", () => {
  const filter = new OpenCodeEventIdentityFilter();
  for (let n = 0; n < 500; n++)
    filter.accept(part("unknown", "x".repeat(1024)), "s");
  const released = filter.accept(message("unknown", "assistant"), "s");
  assert.ok(released.length > 0 && released.length <= 256);
  assert.ok(JSON.stringify(released).length < 70_000);
  filter.accept(part("later", "old private input"), "s");
  assert.deepEqual(
    filter.accept(message("later", "assistant", "next"), "next"),
    [],
  );
  assert.deepEqual(
    filter.accept(
      {
        type: "message.part.updated",
        properties: {
          sessionID: "next",
          part: { id: "unscoped", type: "text", text: "no message identity" },
        },
      },
      "next",
    ),
    [],
  );
});
