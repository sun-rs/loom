// FIXTURE ONLY. Runs the WHOLE unchanged official distribution with isolated
// synthetic API responses. This is an intake probe, never a Loom product URL.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { readSidebarSpacing } from "./sidebar-spacing-metrics.mjs";
import { withPinnedRelease } from "./pinned-release.mjs";

const out = resolve(
  process.env.LOOM_RELEASE_EVIDENCE ?? "/tmp/loom-native-release-evidence",
);
mkdirSync(out, { recursive: true });
const user = {
  id: "isolated-fixture-human",
  name: "Loom",
  displayName: "Loom",
  email: "fixture@example.invalid",
  emailVerified: true,
  preferredLocale: "zh-CN",
  preferredMessageBodyFontSize: "medium",
  profileCompletedAt: "2026-10-30T00:00:00Z",
  createdAt: "2026-10-30T00:00:00Z",
};
const server = {
  id: "isolated-fixture-workspace",
  name: "整版代码隔离验收",
  slug: "loom-intake-fixture",
  role: "owner",
  ownerId: user.id,
  createdAt: user.createdAt,
};
const token =
  "eyJhbGciOiJub25lIn0." +
  Buffer.from(
    JSON.stringify({
      sub: user.id,
      userId: user.id,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url") +
  ".isolated-preview";

function fixtureResponse(request) {
  const url = new URL(request.url());
  if (url.hostname !== "api.raft.build") return undefined;
  const method = request.method(),
    path = url.pathname.replace(/^\/api/, "");
  if (method === "GET") {
    const rows = new Map([
      ["/auth/me", user],
      ["/servers", [server]],
      [
        `/servers/${server.id}/members`,
        [{ ...user, userId: user.id, user, role: "owner" }],
      ],
      [
        `/servers/${server.id}/sidebar-order`,
        {
          channelOrder: channels.map((c) => c.id),
          agentOrder: agents.map((a) => a.id),
          dmOrder: [],
          customSections: [],
          pinned: process.env.LOOM_NATIVE_SIDEBAR_EMPTY
            ? []
            : [{ kind: "channel", id: "fixture-channel-0" }],
          hiddenDmIds: [],
        },
      ],
      [
        `/servers/${server.id}/settings`,
        {
          settings: {
            onboardSettings: {},
            feedbackSettings: { enabled: false },
          },
        },
      ],
      [
        `/servers/${server.id}/machines`,
        [
          {
            id: "machine-a",
            name: "ComputerA",
            displayName: "ComputerA",
            runtimes: [],
            status: "online",
          },
          {
            id: "machine-b",
            name: "ComputerB",
            displayName: "ComputerB",
            runtimes: [],
            status: "offline",
          },
        ],
      ],
      [`/servers/${server.id}/model-label-catalog`, { machines: {} }],
      [
        "/servers/unread-summary",
        [
          {
            serverId: server.id,
            unreadCount: 0,
            activityUnreadCount: 0,
            serverPushMuted: false,
          },
        ],
      ],
      ["/agents", agents],
      ["/channels", channels],
      ["/channels/dm", []],
      ["/channels/threads/followed", []],
      [
        "/channels/inbox",
        { items: [], totalCount: 0, unreadCount: 0, hasMore: false },
      ],
      ["/channels/unread", []],
      ["/tasks/server", { tasks: [], next_cursor: null }],
      ["/messages/attachment-preview/enabled", { enabled: false }],
      ["/product-events/config", { clientEventsAllowed: false }],
    ]);
    if (rows.has(path)) return rows.get(path);
  }
  // These are authentication/projection fixtures, NOT accepted product writes.
  if (method === "POST" && path === "/auth/refresh")
    return {
      user,
      accessToken: token,
      refreshToken: "isolated-fixture-refresh",
    };
  if (method === "POST" && path === "/auth/me/timezone-observation")
    return user;
  return undefined;
}

const agents = [0, 1, 2].map((i) => ({
  id: `fixture-agent-${i}`,
  serverId: server.id,
  name: `Agent${i}`,
  displayName: `Agent${i}`,
  description: `note${i}`,
  machineId: i < 2 ? "machine-a" : "machine-b",
  avatarUrl: "pixel:cat",
  status: "offline",
  runtime: "codex",
  runtimeType: "codex",
  model: "gpt-6-luna",
  createdAt: user.createdAt,
}));
const channels = [0, 1, 2, 3].map((i) => ({
  id: `fixture-channel-${i}`,
  serverId: server.id,
  name: `channel${i}`,
  type: "channel",
  isPrivate: false,
  createdAt: user.createdAt,
}));
const report = {
  fixtureOnly: true,
  productionDataAccessed: false,
  externalNetworkAllowed: false,
  backendAcceptance: false,
  syntheticMemberStoreProjection: true,
  states: [],
};
try {
  await withPinnedRelease(async ({ directory, metadata, verification }) => {
    report.release = metadata.release;
    report.integrity = verification;
    const lock = JSON.parse(
      readFileSync(directory + "/release-lock.json", "utf8"),
    );
    const resources = new Map(lock.files.map((file) => [file.url, file]));
    for (const [engine, name, viewport] of [
      [chromium, "chromium-desktop", { width: 1440, height: 1000 }],
    ]) {
      const browser = await engine.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport,
          locale: "zh-CN",
          serviceWorkers: "block",
          isMobile: viewport.width < 600,
          hasTouch: viewport.width < 600,
        });
        const requests = [],
          unsupported = [],
          staticMisses = [],
          errors = [],
          websockets = [],
          loaded = new Set();
        report[name] = {
          loadedResources: 0,
          staticMisses,
          errors,
          requests,
          unsupported,
          blockedWebSockets: websockets,
        };
        await context.routeWebSocket("**/*", (socket) => {
          websockets.push(socket.url());
          socket.close();
        });
        await context.addInitScript(
          ({ token }) => {
            localStorage.setItem("slock_access_token", token);
            localStorage.setItem(
              "slock_refresh_token",
              "isolated-fixture-refresh",
            );
            localStorage.setItem("slock_locale", "zh-CN");
            window.__loomIntakeDocument = crypto.randomUUID();
          },
          { token },
        );
        await context.route("**/*", async (route) => {
          const request = route.request(),
            url = new URL(request.url());
          requests.push({
            method: request.method(),
            url: request.url(),
            type: request.resourceType(),
          });
          let asset = resources.get(request.url());
          if (
            !asset &&
            url.hostname === "app.raft.build" &&
            request.isNavigationRequest()
          )
            asset = resources.get(lock.entry);
          if (asset) {
            loaded.add(asset.url);
            return route.fulfill({
              status: 200,
              contentType: asset.mime,
              body: readFileSync(directory + "/" + asset.file),
            });
          }
          const fixture = fixtureResponse(request);
          if (fixture !== undefined)
            return route.fulfill({ status: 200, json: fixture });
          if (
            url.hostname === "app.raft.build" &&
            (/\.(?:js|css|woff2?|png|svg)$/.test(url.pathname) ||
              request.resourceType() === "script")
          )
            staticMisses.push(request.url());
          unsupported.push({ method: request.method(), url: request.url() });
          return route.fulfill({
            status: 501,
            json: { error: "ISOLATED_INTAKE_UNBOUND", path: url.pathname },
          });
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto("https://app.raft.build/s/" + server.slug + "/");
        await page
          .getByRole("button", { name: server.name, exact: true })
          .waitFor();

        for (const [label, state] of [
          [null, "chat"],
          ["成员", "roles"],
          ["计算机", "computers"],
          ["设置", "settings"],
        ]) {
          if (label)
            await page
              .getByRole("button", { name: label, exact: true })
              .first()
              .click();
          await page.waitForTimeout(400);
          if (state === "roles") {
            // Native members hydration can replace API fixtures; project only synthetic test data into its own store.
            await page.evaluate(async (agents) => {
              const m =
                await import("https://app.raft.build/assets/app-shell-DOYrxQ-_.js");
              m.yu.setState({ agents });
            }, agents);
            await page.waitForTimeout(150);
          }
          await page.evaluate(() => document.fonts.ready);
          const root = page.locator('[data-slot="sidebar-root"]').first();
          const spacing = await root.evaluate(readSidebarSpacing);
          await page.screenshot({ path: resolve(out, state + ".png") });
          const hint = page.getByTestId("sidebar-pinned-empty-hint");
          const emptyPinned =
            state === "chat" && (await hint.count())
              ? await hint.evaluate((el) => ({
                  text: el.textContent,
                  height: el.getBoundingClientRect().height,
                  dropZoneHeight:
                    el.parentElement.getBoundingClientRect().height,
                  marginBottom: getComputedStyle(el).marginBottom,
                  paddingTop: getComputedStyle(el).paddingTop,
                }))
              : undefined;
          report.states.push({
            state,
            spacing,
            ...(emptyPinned ? { emptyPinned } : {}),
          });
        }
        assert.deepEqual(
          staticMisses,
          [],
          "all requested first-party static assets must be captured",
        );
        assert.deepEqual(errors, [], "unchanged native code must not throw");
        report[name] = {
          loadedResources: loaded.size,
          staticMisses,
          errors,
          requests,
          unsupported,
          blockedWebSockets: websockets,
        };
      } finally {
        await browser.close();
      }
    }
  });
} finally {
  writeFileSync(
    resolve(out, "native-release-browser.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    {
      fixtureOnly: true,
      states: report.states.length,
      report: resolve(out, "native-release-browser.json"),
    },
    null,
    2,
  ),
);
