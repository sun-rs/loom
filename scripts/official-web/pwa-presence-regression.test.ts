import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { messageInstancePresence } from "../../frontends/raft/loom/message-status.ts";
import { instanceActivity } from "../../frontends/raft/loom/working-state.ts";
const catalog = [
  { definition: { agentId: "definition", participantId: "instance" } },
] as any;
const facts = {
  roomId: "channel",
  members: ["instance"],
  activities: [
    { roomId: "channel", participantId: "instance", state: "idle" as const },
  ],
};
test("idle Channel work cannot paint an online Host grey; body and settings use the same stable-ID observation", () => {
  for (const activity of [
    "online",
    "offline",
    "working",
    "thinking",
    "error",
  ] as const) {
    const presence = [{ agentId: "definition", activity }] as any;
    assert.equal(
      messageInstancePresence(facts, "channel", "instance", catalog, presence),
      instanceActivity("instance", catalog, presence),
    );
  }
  assert.equal(
    messageInstancePresence(facts, "channel", "instance", catalog, []),
    "unknown",
  );
  assert.equal(
    messageInstancePresence(facts, "other", "instance", catalog, [
      { agentId: "definition", activity: "online" },
    ] as any),
    "unknown",
  );
  assert.equal(
    messageInstancePresence(
      { ...facts, members: [] },
      "channel",
      "instance",
      catalog,
      [{ agentId: "definition", activity: "online" }] as any,
    ),
    "left",
  );
  assert.equal(
    messageInstancePresence(facts, "channel", "other", catalog, [
      { agentId: "definition", activity: "online" },
    ] as any),
    "left",
  );
});
test("iOS installed mode works when CSS standalone is false and keeps the same frame through orientation changes", () => {
  const attrs = new Map(),
    style: any = {},
    classes = new Set(),
    listeners: Function[] = [];
  let standalone = false;
  const root: any = {
    style,
    removeAttribute: (n: string) => attrs.delete(n),
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    classList: {
      toggle: (n: string, on: boolean) =>
        on ? classes.add(n) : classes.delete(n),
    },
  };
  const meta = { content: "#FFD440" };
  vm.runInNewContext(
    readFileSync(
      "frontends/raft/packages/web/public/app-theme-bootstrap.js",
      "utf8",
    ),
    {
      document: { documentElement: root, querySelector: () => meta },
      navigator: { standalone: true },
      localStorage: { getItem: () => null },
      matchMedia: (q: string) => ({
        get matches() {
          return q.includes("standalone") ? standalone : false;
        },
        addEventListener: (_: string, fn: Function) => listeners.push(fn),
      }),
    },
  );
  assert.equal(attrs.get("data-loom-installed"), "true");
  standalone = true;
  listeners.forEach((fn) => fn());
  standalone = false;
  listeners.forEach((fn) => fn());
  assert.equal(attrs.get("data-loom-installed"), "true");
  assert.equal(meta.content, "#FFD440");
});
test("the installed chrome edge exists in the parser shell before app chunks and is not recreated by React", async () => {
  const { pwaChromeHtml } =
    await import("../../frontends/raft/loom/pwa-chrome.ts");
  const source = readFileSync("frontends/raft/packages/web/index.html", "utf8"),
    out = pwaChromeHtml(source);
  assert.equal(
    (out.match(/<div[^>]*data-testid="pwa-status-bar-surface"/g) ?? []).length,
    1,
  );
  assert.ok(
    out.indexOf('id="loom-pwa-first-paint"') <
      out.indexOf("/app-theme-bootstrap.js"),
  );
  assert.ok(
    out.indexOf(
      '<div aria-hidden="true" data-testid="pwa-status-bar-surface"',
    ) < out.indexOf('id="root"'),
  );
  assert.match(out, /data-loom-installed/);
  assert.doesNotMatch(out, /script-src|unsafe-inline/);
  assert.doesNotMatch(
    readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8"),
    /data-testid="pwa-status-bar-surface"/,
  );
});
test("iOS status metadata is parsed before a slow blocking theme script", async () => {
  const { pwaChromeHtml } =
    await import("../../frontends/raft/loom/pwa-chrome.ts");
  const out = pwaChromeHtml(
    readFileSync("frontends/raft/packages/web/index.html", "utf8"),
  );
  const blocking = out.indexOf("/app-theme-bootstrap.js");
  assert.ok(out.indexOf('name="apple-mobile-web-app-capable"') < blocking);
  assert.ok(
    out.indexOf('name="apple-mobile-web-app-status-bar-style"') < blocking,
  );
});
test("missing Room work diagnostics cannot hide a known member's actual Host presence", () => {
  assert.equal(
    messageInstancePresence(
      { ...facts, activities: [] },
      "channel",
      "instance",
      catalog,
      [{ agentId: "definition", activity: "online" }] as any,
    ),
    "online",
  );
});
