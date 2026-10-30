// FIXTURE ONLY. Runs the WHOLE unchanged official distribution with isolated
// synthetic API responses. This is an intake probe, never a Loom product URL.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
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
          channelOrder: [],
          agentOrder: [],
          dmOrder: [],
          customSections: [],
          pinned: [],
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
      [`/servers/${server.id}/machines`, []],
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
      ["/agents", []],
      ["/channels", []],
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

const report = {
  fixtureOnly: true,
  productionDataAccessed: false,
  externalNetworkAllowed: false,
  backendAcceptance: false,
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
      [chromium, "chromium-mobile", { width: 390, height: 844 }],
      [webkit, "webkit-mobile", { width: 390, height: 844 }],
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
        const documentId = await page.evaluate(
          () => window.__loomIntakeDocument,
        );
        const capture = async (state) => {
          const ready = {
            chat: () => page.getByText("还没有频道", { exact: true }),
            activity: () => page.getByText(/0 条进行中.*0 条未读/),
            tasks: () => page.getByText("0 个频道任务", { exact: true }),
            members: () => page.getByText("关系图", { exact: true }),
            computers: () => page.getByText("还没有计算机", { exact: true }),
            settings: () =>
              page.getByTestId("account-profile-display-name-input"),
            appearance: () => page.getByTestId("message-font-size-md"),
          };
          await ready[state]()
            .first()
            .waitFor({ state: "visible", timeout: 10000 });
          assert.equal(
            await page.evaluate(() => window.__loomIntakeDocument),
            documentId,
            "SPA navigation must not reload the document",
          );
          const text = await page.locator("body").innerText();
          assert.ok(text.trim(), "native page must render");
          const screenshot = name + "-" + state + ".png";
          await page.screenshot({
            path: resolve(out, screenshot),
            fullPage: true,
          });
          report.states.push({
            engine: name,
            state,
            url: page.url(),
            viewport,
            screenshot,
            text: text.slice(0, 3500),
            documentPreserved: true,
          });
        };
        await capture("chat");
        if (viewport.width > 600) {
          for (const [label, state] of [
            ["动态", "activity"],
            ["任务", "tasks"],
            ["成员", "members"],
            ["计算机", "computers"],
            ["设置", "settings"],
          ]) {
            await page
              .getByRole("button", { name: label, exact: true })
              .first()
              .click();
            await capture(state);
          }
        } else {
          // Official mobile route composition is tested as delivered; Loom's
          // owner-approved bottom-nav/folding policies are a later adapter gate.
          for (const [path, state] of [
            ["activity", "activity"],
            ["tasks", "tasks"],
            ["settings/appearance", "appearance"],
          ]) {
            await page.evaluate(
              (path) => {
                history.pushState(null, "", path);
                dispatchEvent(new PopStateEvent("popstate"));
              },
              "/s/" + server.slug + "/" + path,
            );
            await capture(state);
          }
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
