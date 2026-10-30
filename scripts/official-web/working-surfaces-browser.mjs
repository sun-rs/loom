import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** FIXTURE ONLY: real Core/inventory; deterministic read-only Host observations. No paid model. */
export async function verifyWorkingSurfaces({
  browser,
  origin,
  channels,
  instances,
}) {
  const out = resolve(
    process.env.LOOM_WORKING_EVIDENCE ?? "/tmp/loom-working-surfaces140",
  );
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let phase = "thinking",
      failSidebar = false,
      presenceReads = 0,
      catalogReads = 0;
    await page.route("**/v3/client/agents/presence/list", async (route) => {
      presenceReads++;
      if (phase === "unavailable")
        return route.fulfill({
          status: 503,
          body: "FIXTURE observation unavailable",
        });
      await route.fulfill({
        json: {
          observedAt: new Date().toISOString(),
          agents: instances.map((i, n) => ({
            agentId: i.agentId,
            activity: n === 0 ? phase : "online",
            reason:
              n === 0 ? (phase === "offline" ? "host_offline" : phase) : "idle",
          })),
        },
      });
    });
    await page.route("**/v3/client/agents/list", async (route) => {
      catalogReads++;
      await route.continue();
    });
    await page.route("**/v3/client/sidebar/get", async (route) => {
      if (failSidebar)
        return route.fulfill({
          status: 503,
          body: "FIXTURE sidebar temporarily unavailable",
        });
      await route.continue();
    });
    try {
      await page.goto(`${origin}/?room=${channels[2].roomId}`);
      await page.getByTestId("composer-textarea").waitFor();
      const header = page.getByTestId("channel-header-working");
      await header.waitFor({ state: "attached" });
      assert.match(await header.textContent(), /1.*工作中/);
      assert.equal(
        await page.getByTestId("sidebar-stale-notice").count(),
        0,
        "healthy initial read is not stale",
      );
      if (width === 1440) {
        const summary = page.getByTestId("working-now-summary");
        await summary.click();
        const popup = page.getByTestId("working-now-list");
        await popup.getByText("思考中…", { exact: true }).waitFor();
        assert.equal(
          await popup.locator("[data-slot='avatar-badge']").count(),
          1,
        );
        await page.screenshot({
          path: resolve(out, `working-popup-${width}.png`),
        });
        await page.keyboard.press("Escape");
      }
      if (width === 390) {
        await page.goto(`${origin}/?room=${channels[2].roomId}&chat=list`);
        await page.getByTestId("working-now-summary").click();
        await page
          .getByTestId("working-now-list")
          .getByText("思考中…", { exact: true })
          .waitFor();
        await page.screenshot({
          path: resolve(out, `working-popup-${width}.png`),
        });
        await page.keyboard.press("Escape");
        await page.goto(`${origin}/?room=${channels[2].roomId}`);
        await page.getByTestId("composer-textarea").waitFor();
      }
      await page.getByTestId("loom-channel-control-trigger").click();
      const sheet = page.getByTestId("loom-channel-control-sheet");
      const strip = sheet.getByTestId("channel-overflow-members-entry");
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="channel-member-strip-inset"] [data-slot="avatar-badge"]',
          ).length === 2 &&
          [
            ...document.querySelectorAll(
              '[data-testid="channel-member-strip-inset"] [data-slot="avatar-badge"]',
            ),
          ].every((e) => {
            const r = e.getBoundingClientRect();
            return r.x >= 0 && r.right <= innerWidth;
          }),
      );
      const stripBadges = await sheet
        .getByTestId("channel-member-strip-inset")
        .locator("[data-slot='avatar-badge']")
        .evaluateAll((es) =>
          es.map((e) => ({
            presence: e.className.includes("--presence-busy")
              ? "busy"
              : e.className.includes("--presence-online")
                ? "online"
                : "offline",
            background: getComputedStyle(e).backgroundColor,
            box: JSON.stringify(e.getBoundingClientRect().toJSON()),
          })),
        );
      assert.ok(
        stripBadges.some((b) => b.presence === "busy"),
        "working strip badge is native yellow/busy",
      );
      assert.ok(
        stripBadges.some((b) => b.presence === "online"),
        "idle live peer remains green, never counted as working",
      );
      await strip.click();
      const memberPage = sheet.getByTestId("member-page");
      await memberPage.waitFor();
      assert.equal(
        await memberPage
          .locator('[data-member-row] [data-slot="avatar-badge"]')
          .count(),
        2,
      );
      phase = "offline";
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="channel-header-working"]'),
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '[data-testid="member-page"] [data-slot="avatar-badge"][class*="--presence-offline"]',
          ).length === 1,
      );
      phase = "working";
      await page.waitForFunction(
        () =>
          !!document.querySelector('[data-testid="channel-header-working"]'),
      );
      await page.screenshot({ path: resolve(out, `members-${width}.png`) });
      await page.goto(`${origin}/?view=memory`);
      const memory = page.getByTestId("loom-memory-list");
      await memory.waitFor();
      const backgrounds = await memory.evaluate((e) => ({
        list: getComputedStyle(e).backgroundColor,
        canvas: getComputedStyle(
          document.querySelector('[data-testid="memory-master"]'),
        ).backgroundColor,
      }));
      await page.screenshot({ path: resolve(out, `memory-${width}.png`) });
      assert.equal(
        backgrounds.list,
        backgrounds.canvas,
        "memory content uses canvas, not sidebar cream",
      );
      if (width === 1440) {
        await page.getByTestId("working-now-summary").click();
        await page
          .getByTestId("working-now-list")
          .locator("button[data-agent-id]")
          .click();
        await page.getByTestId("profile-panel").waitFor();
        assert.ok(
          page.url().includes(channels[2].roomId),
          "global item navigates to its actual Channel and instance",
        );
      }
      await page.goto(`${origin}/?view=computers&computer=overview`);
      const overview = page.getByTestId("computers-rack-overview");
      await overview.waitFor();
      await page.getByTestId("computers-rack-counts").getByText(/1/).waitFor();
      await page.screenshot({
        path: resolve(out, `overview-list-${width}.png`),
      });
      await page.getByTestId("computers-rack-view-cards").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="computers-rack"]')
            ?.getAttribute("data-view") === "cards",
      );
      await page.screenshot({
        path: resolve(out, `overview-cards-${width}.png`),
      });
      await page.reload();
      await overview.waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="computers-rack"]')
            ?.getAttribute("data-view") === "cards",
      );
      await page.getByTestId("computers-rack-view-list").click();
      await page.locator('[data-testid^="rack-row-name-"]').click();
      await page.getByTestId("computer-detail").waitFor();
      if (width === 1440) {
        await page.getByTestId("sidebar-computers-overview").click();
        await overview.waitFor();
      }
      await page.goto(`${origin}/?room=${channels[0].roomId}`);
      await page.getByTestId("composer-textarea").waitFor();
      assert.equal(
        await header.count(),
        0,
        "working member in another room does not leak into current header",
      );
      assert.equal(
        await page
          .locator('.loom-chat-header [data-slot="panel-meta"]')
          .count(),
        0,
        "an inactive, description-free Channel has no blank subtitle row",
      );
      if (width === 1440)
        await page.getByTestId("working-now-summary").waitFor();
      phase = "unavailable";
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="working-now-summary"]'),
      );
      failSidebar = true;
      await page.goto(`${origin}/?room=${channels[0].roomId}&chat=list`);
      const notice = page.getByTestId("sidebar-stale-notice");
      await notice.waitFor();
      assert.equal(await notice.getAttribute("data-status"), "info");
      const noticeColor = await notice.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      await page.screenshot({
        path: resolve(out, `sidebar-unavailable-${width}.png`),
      });
      failSidebar = false;
      await page.getByRole("button", { name: "刷新列表", exact: true }).click();
      await notice.waitFor({ state: "hidden" });
      assert.equal(
        await page.getByTestId("loom-live-agent-activity").count(),
        0,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        presenceReads,
        catalogReads,
        stripBadges,
        memoryBackgrounds: backgrounds,
        noticeColor,
        workingTransitions: true,
        globalNavigation: true,
        overviewViewsPersist: true,
        failureClearsWork: true,
        healthyReadsHaveNoStaleNotice: true,
      });
    } finally {
      await ctx.close();
    }
  }
  writeFileSync(
    resolve(out, "browser.json"),
    JSON.stringify(
      {
        fixture:
          "real Core with deterministic read-only AgentHost observations; no paid providers or production writes",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  return results;
}
