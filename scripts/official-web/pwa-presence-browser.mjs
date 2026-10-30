import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyPwaPresence({
  browser,
  origin,
  client,
  channels,
  instances,
  head,
}) {
  const out =
    process.env.LOOM_PWA_PRESENCE_EVIDENCE ?? "/tmp/loom-pwa-presence";
  mkdirSync(out, { recursive: true });
  const result = {
    temporaryCore: true,
    paidCalls: 0,
    coldChrome: [],
    presence: [],
  };
  for (const width of [390, 844, 1130]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 390 },
      hasTouch: true,
      locale: "zh-CN",
      colorScheme: "light",
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", {
        value: true,
        configurable: true,
      });
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    let release;
    let releaseBootstrap, requestedBootstrap;
    const bootstrapRequested = new Promise((r) => (requestedBootstrap = r));
    const bootstrapGate = new Promise((r) => (releaseBootstrap = r));
    await page.route("**/app-theme-bootstrap.js", async (route) => {
      requestedBootstrap();
      await bootstrapGate;
      await route.continue();
    });
    const gate = new Promise((r) => (release = r));
    let held = 0;
    await page.route(/\/assets\/.*\.js(?:\?|$)/, async (route) => {
      held++;
      await gate;
      await route.continue();
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(origin + "/?chat=list", { waitUntil: "commit" });
      await bootstrapRequested;
      const parserPaint = await page.evaluate(() => ({
        capable: document.querySelector(
          'meta[name="apple-mobile-web-app-capable"]',
        )?.content,
        status: document.querySelector(
          'meta[name="apple-mobile-web-app-status-bar-style"]',
        )?.content,
        color: getComputedStyle(document.documentElement).backgroundColor,
        appMounted: !!document.querySelector(
          '[data-testid="loom-channel-app"]',
        ),
      }));
      assert.equal(parserPaint.capable, "yes");
      assert.equal(parserPaint.status, "black-translucent");
      assert.equal(parserPaint.color, "rgb(255, 212, 64)");
      assert.equal(parserPaint.appMounted, false);
      releaseBootstrap();
      const edge = page.getByTestId("pwa-status-bar-surface");
      await edge.waitFor();
      const before = await edge.evaluate((el) => {
        window.__coldEdge = el;
        return {
          box: el.getBoundingClientRect().toJSON(),
          color: getComputedStyle(el).backgroundColor,
          theme: document.querySelector('meta[name="theme-color"]').content,
          installed: document.documentElement.dataset.loomInstalled,
          cssStandalone: matchMedia("(display-mode: standalone)").matches,
          appMounted: !!document.querySelector(
            '[data-testid="loom-channel-app"]',
          ),
        };
      });
      writeFileSync(
        out + "/cold-before-" + width + ".json",
        JSON.stringify(before, null, 2),
      );
      assert.equal(before.installed, "true");
      assert.equal(before.cssStandalone, false);
      assert.equal(before.appMounted, false);
      assert.ok(before.box.height >= 5 && before.box.width === width);
      assert.equal(before.theme, "#FFD440");
      assert.notEqual(before.color, "rgb(255, 255, 255)");
      release();

      await page.getByTestId("public-server-channel-sidebar-root").waitFor();
      for (const view of ["activity", "search", "tasks"]) {
        // Real SPA navigation: the parser edge survives every route commit.
        await page.evaluate((v) => {
          history.pushState({}, "", "/?view=" + v);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, view);
        if (view === "search")
          await page.getByTestId("message-search-input").waitFor();
        else if (view === "tasks")
          await page.getByTestId("loom-tasks-page").waitFor();
        else await page.getByTestId("discovery-results").waitFor();
        await page.waitForFunction(
          () => document.documentElement.dataset.loomInstalled === "true",
        );
        assert.equal(
          await edge.evaluate((el) => el === window.__coldEdge),
          true,
        );
        assert.equal(
          await edge.evaluate((el) => getComputedStyle(el).display),
          "block",
        );
      }
      await page.setViewportSize({
        width: width === 390 ? 844 : 390,
        height: width === 390 ? 390 : 844,
      });
      assert.equal(await edge.evaluate((el) => el === window.__coldEdge), true);
      assert.ok((await edge.boundingBox()).height >= 5);
      await page.screenshot({ path: out + "/installed-" + width + ".png" });
      assert.deepEqual(errors, []);
      result.coldChrome.push({
        width,
        heldAppModules: held,
        parserPaintBeforeThemeScript: parserPaint,
        beforeApp: before,
        edgePersistsAcrossRoutes: true,
        edgePersistsAfterRotation: true,
        errors,
      });
    } catch (error) {
      writeFileSync(
        out + "/failure.json",
        JSON.stringify(
          {
            width,
            error: error.stack,
            body: await page.locator("body").innerText(),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      releaseBootstrap();
      release();
      await ctx.close();
    }
  }
  const room = channels[2],
    instance = instances[0];
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE shared Host avatar observation",
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "pwa-presence-message",
  });
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      locale: "zh-CN",
      hasTouch: width === 390,
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(14000);
    let phase = "online";
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/v3/client/rooms/timeline", async (route) => {
      const r = await route.fetch(),
        data = await r.json();
      for (const row of data.items ?? [])
        if (row.kind === "message") row.message.actorId = instance.instanceId;
      await route.fulfill({ response: r, json: data });
    });
    // Business work is deliberately idle throughout: connectivity is independent.
    await page.route(
      "**/v3/client/rooms/agents/activity/list",
      async (route) => {
        const r = await route.fetch(),
          data = await r.json();
        for (const a of data.agents) a.state = "idle";
        await route.fulfill({ response: r, json: data });
      },
    );
    await page.route("**/v3/client/agents/presence/list", (route) =>
      phase === "unknown"
        ? route.fulfill({
            status: 503,
            body: "FIXTURE observation unavailable",
          })
        : route.fulfill({
            json: {
              observedAt: new Date().toISOString(),
              agents: instances.map((i, n) => ({
                agentId: i.agentId,
                activity: n === 0 ? phase : "online",
                reason: phase === "offline" ? "host_offline" : "idle",
              })),
            },
          }),
    );
    try {
      await page.goto(origin + "/?room=" + room.roomId);
      const dot = page.getByTestId("message-instance-status").first();
      await dot.waitFor();
      await page.getByTestId("loom-channel-control-trigger").click();
      const sheet = page.getByTestId("loom-channel-control-sheet");
      await sheet
        .getByTestId("channel-member-strip-inset")
        .locator('[data-slot="avatar-badge"]')
        .first()
        .waitFor();
      const colors = [];
      for (const next of [
        "online",
        "working",
        "thinking",
        "offline",
        "error",
      ]) {
        phase = next;
        await page.waitForFunction(
          (p) =>
            document
              .querySelector('[data-testid="message-instance-status"]')
              ?.getAttribute("data-state") === p,
          next,
        );
        const bodyColor = await dot.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        );
        const memberColors = await sheet
          .getByTestId("channel-member-strip-inset")
          .locator('[data-slot="avatar-badge"]')
          .evaluateAll((es) =>
            es.map((el) => getComputedStyle(el).backgroundColor),
          );
        assert.ok(
          memberColors.includes(bodyColor),
          "body/settings Host colour diverged at " + next,
        );
        colors.push({ activity: next, body: bodyColor, members: memberColors });
      }
      phase = "unknown";
      await dot.waitFor({ state: "hidden" });
      await page.screenshot({
        path: out + "/shared-presence-" + width + ".png",
      });
      assert.deepEqual(errors, []);
      result.presence.push({
        width,
        roomWorkRemainsIdle: true,
        sharedHostColors: colors,
        missingObservationHidesBodyBadge: true,
        errors,
      });
    } finally {
      await ctx.close();
    }
  }
  writeFileSync(out + "/report.json", JSON.stringify(result, null, 2) + "\n");
  return result;
}
