// Bilateral real pointer/keyboard operations, against the unchanged original App.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { staticBuilds, fixturePage } from "./browser-fixture.mjs";
import { interactionFixture, channels } from "./interaction-fixture.mjs";
import { slug, instant } from "./pixel-fixture.mjs";
import { comparePixels } from "./pixels.mjs";
const require = createRequire(
    resolve("frontends/raft/upstream/web-1.21.23/packages/web/package.json"),
  ),
  sharp = require("sharp");
const out =
  process.env.LOOM_WEB123_INTERACTION_EVIDENCE ??
  "/tmp/loom-web123-interactions";
mkdirSync(out, { recursive: true });
const builds = await staticBuilds(),
  browser = await chromium.launch({ headless: true }),
  report = {
    source: "db5e399",
    ui: "0.7.0",
    fixtureOnly: true,
    productionData: false,
    unmodifiedReference: true,
    unmasked: true,
    fixedClock: instant,
    locale: "zh-CN",
    dpr: 1,
    arms: {},
    pixels: [],
  };
async function until(check, message) {
  const end = Date.now() + 12000;
  while (!(await check())) {
    assert.ok(Date.now() < end, message);
    await new Promise((r) => setTimeout(r, 30));
  }
}
try {
  for (const arm of ["reference", "loom"]) {
    const fixture = interactionFixture(arm),
      origin = builds.origins[arm],
      run = await fixturePage(browser, origin, fixture),
      { page, context } = run;
    const captures = {},
      states = {},
      metrics = {};
    report.arms[arm] = { captures, states, metrics };
    const row = (id) =>
      page
        .locator(`[data-sidebar-channel-id="${id}"]`)
        .filter({ visible: true });
    const container = (id) =>
      page.locator(`[data-sidebar-dnd-container="sidebar:container:${id}"]`);
    const menu = () =>
      page
        .locator('[data-slot="context-menu-content"]')
        .filter({ visible: true });
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      assert.ok(
        await page.evaluate(() =>
          Array.from(document.fonts).some(
            (f) => f.status === "loaded" && f.family.includes("Space Grotesk"),
          ),
        ),
        "official font did not load",
      );
      await page.waitForTimeout(350);
      captures[name] = out + "/" + arm + "-" + name + ".png";
      await page.screenshot({ path: captures[name], animations: "disabled" });
      const state = fixture.state(),
        ids = new Map(state.sections.map((s) => [s.id, "section:" + s.name]));
      states[name] = {
        ...state,
        sections: state.sections.map((s) => ({ ...s, id: ids.get(s.id) })),
        sectionOrder: state.sectionOrder.map((id) => ids.get(id) ?? id),
      };
    }
    async function changed(action) {
      const count = fixture.writes.length;
      await action();
      await until(
        () => fixture.writes.length > count,
        "no saved sidebar mutation",
      );
      await page.waitForTimeout(150);
    }
    async function open() {
      await page.goto(origin + "/s/" + slug + "/");
      await row(channels[0].id).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
    }
    async function startDrag(id) {
      const b = await row(id).boundingBox();
      await page.mouse.move(
        b.x + Math.min(70, b.width / 2),
        b.y + b.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        b.x + Math.min(70, b.width / 2) + 12,
        b.y + b.height / 2,
        { steps: 4 },
      );
      await page.getByTestId("sidebar-drag-overlay").waitFor();
    }
    async function drop(id, target) {
      await changed(async () => {
        await startDrag(id);
        const b = await target.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, {
          steps: 22,
        });
        await page.waitForTimeout(300);
        await page.mouse.up();
      });
      await page
        .getByTestId("sidebar-drag-overlay")
        .waitFor({ state: "hidden" });
    }
    try {
      await open();
      const hint = page.getByTestId("sidebar-pinned-empty-hint");
      if (!(await hint.isVisible()))
        await page.getByTestId("sidebar-section-toggle-pinned").click();
      await hint.waitFor();
      assert.equal((await hint.innerText()).trim(), "将频道或私信拖到这里置顶");
      await page.mouse.move(1000, 100);
      await capture("default");

      await page
        .getByTestId("sidebar-scroll-surface")
        .click({ button: "right", position: { x: 30, y: 700 } });
      await page.getByTestId("sidebar-surface-context-menu").waitFor();
      await capture("background-menu");
      await page.keyboard.press("Escape");
      await page
        .getByTestId("sidebar-surface-context-menu")
        .waitFor({ state: "hidden" });

      await row(channels[0].id).click({ button: "right" });
      await menu().waitFor();
      await capture("channel-menu");
      await changed(() => menu().getByText("置顶", { exact: true }).click());
      assert.deepEqual(fixture.state().pinned, [
        { kind: "channel", id: channels[0].id },
      ]);
      await page.mouse.move(1000, 100);
      await capture("pinned");
      await open();
      await page
        .getByTestId("sidebar-section-block-pinned")
        .locator(`[data-sidebar-channel-id="${channels[0].id}"]`)
        .waitFor();
      await row(channels[0].id).click({ button: "right" });
      await changed(() =>
        menu().getByText("取消置顶", { exact: true }).click(),
      );
      assert.deepEqual(fixture.state().pinned, []);

      await page
        .getByTestId("sidebar-custom-section-work")
        .locator('[data-slot="sidebar-section-disclosure"]')
        .click({ button: "right" });
      const group = page.getByTestId(
        "sidebar-section-context-menu-custom:work",
      );
      await group.waitFor();
      await capture("group-menu");
      await changed(() => group.getByText("A-Z", { exact: true }).click());
      assert.equal(fixture.state().sections[0].sortMode, "az");
      await page
        .getByTestId("sidebar-custom-section-work")
        .locator('[data-slot="sidebar-section-disclosure"]')
        .click({ button: "right" });
      await changed(() => group.getByText("手动", { exact: true }).click());

      // Actual DndKit pointer sensor, not HTML5 dragTo or direct store updates.
      await drop(channels[1].id, container("pinned"));
      assert.deepEqual(fixture.state().pinned, [
        { kind: "channel", id: channels[1].id },
      ]);
      await page.mouse.move(1000, 100);
      await capture("drag-pinned");
      await drop(channels[1].id, container("custom:work"));
      assert.deepEqual(fixture.state().pinned, []);
      assert.deepEqual(fixture.state().sections[0].items, [channels[1].id]);
      await page.mouse.move(1000, 100);
      await capture("drag-custom");
      const before = structuredClone(fixture.state()),
        writeCount = fixture.writes.length;
      await startDrag(channels[1].id);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page
        .getByTestId("sidebar-drag-overlay")
        .waitFor({ state: "hidden" });
      await page.waitForTimeout(300);
      assert.equal(fixture.writes.length, writeCount);
      assert.deepEqual(fixture.state(), before);
      await open();
      assert.deepEqual(fixture.state(), before);
      await page
        .getByTestId("sidebar-custom-section-work")
        .locator(`[data-sidebar-channel-id="${channels[1].id}"]`)
        .waitFor();
      await page.mouse.move(1000, 100);
      await capture("persisted");

      await row(channels[1].id).click({ button: "right" });
      await menu().getByText("移动到分区", { exact: true }).hover();
      const move = page.getByRole("menu", { name: "移动到分区", exact: true });
      await move.waitFor();
      await capture("move-submenu");
      await changed(() => move.getByText("移出分区", { exact: true }).click());
      assert.deepEqual(fixture.state().sections[0].items, []);
      await page
        .getByTestId("sidebar-scroll-surface")
        .click({ button: "right", position: { x: 30, y: 700 } });
      await page
        .getByTestId("sidebar-surface-context-menu")
        .getByText("新建分区…", { exact: true })
        .click();
      const sectionDialog = page.locator('[data-slot="dialog-card"]');
      await sectionDialog
        .getByRole("textbox", { name: "名称", exact: true })
        .fill("Study");
      await capture("create-section-form");
      await changed(() =>
        sectionDialog
          .getByRole("textbox", { name: "名称", exact: true })
          .press("Enter"),
      );
      const created = fixture.state().sections.find((s) => s.name === "Study");
      assert.ok(created);
      const section = page.getByTestId("sidebar-custom-section-" + created.id),
        sectionMenu = page.getByTestId(
          "sidebar-section-context-menu-custom:" + created.id,
        );
      await section
        .locator('[data-slot="sidebar-section-disclosure"]')
        .click({ button: "right" });
      await sectionMenu.getByText("编辑分区…", { exact: true }).click();
      await sectionDialog
        .getByRole("textbox", { name: "名称", exact: true })
        .fill("Research");
      await changed(() =>
        sectionDialog
          .getByRole("button", { name: "保存", exact: true })
          .click(),
      );
      assert.equal(
        fixture.state().sections.find((s) => s.id === created.id).name,
        "Research",
      );
      await page.mouse.move(1000, 100);
      await capture("renamed-section");
      await section
        .locator('[data-slot="sidebar-section-disclosure"]')
        .click({ button: "right" });
      await sectionMenu.getByText("删除分区", { exact: true }).click();
      await capture("delete-section-confirm");
      await changed(() =>
        page.getByRole("button", { name: "删除分区", exact: true }).click(),
      );
      assert.equal(fixture.state().sections.length, 1);
      await drop(channels[2].id, row(channels[0].id));
      assert.deepEqual(
        fixture.state().channelOrder,
        [channels[0].id, channels[2].id, channels[1].id],
        "dropping on the row midpoint inserts after it in the original DnD projection",
      );
      await page.mouse.move(1000, 100);
      await capture("manual-channel-order");

      const sidebar = page.getByTestId("sidebar-root"),
        handle = page
          .locator(".cursor-col-resize")
          .filter({ visible: true })
          .first();
      metrics.defaultWidth = (await sidebar.boundingBox()).width;
      assert.equal(metrics.defaultWidth, 240);
      async function resize(delta, panel = sidebar) {
        const b = await handle.boundingBox();
        await page.mouse.move(
          b.x + b.width / 2,
          b.y + Math.min(120, b.height / 2),
        );
        await page.mouse.down();
        await page.mouse.move(
          b.x + b.width / 2 + delta,
          b.y + Math.min(120, b.height / 2),
          { steps: 15 },
        );
        await page.mouse.up();
        await page.waitForTimeout(200);
        return (await panel.boundingBox()).width;
      }
      metrics.minimum = await resize(-900);
      assert.equal(metrics.minimum, 180);
      metrics.maximum = await resize(1200);
      assert.equal(metrics.maximum, 320);
      metrics.saved = await resize(-50);
      assert.equal(metrics.saved, 270);
      await open();
      metrics.reloaded = (await sidebar.boundingBox()).width;
      assert.equal(metrics.reloaded, 270);
      await page.mouse.move(1000, 100);
      await capture("resized-persisted");
      metrics.breakpoints = [];
      for (const width of [390, 767, 768, 1023, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(250);
        metrics.breakpoints.push({
          width,
          sidebar: await sidebar.boundingBox(),
          main: await page.getByTestId("thread-main-column").boundingBox(),
          resizerVisible: await handle.isVisible(),
        });
        await page.mouse.move(width - 10, 100);
        await capture("width-" + width);
      }
      await page.goto(origin + "/s/" + slug + "/activity");
      await page.getByText("动态为空", { exact: true }).waitFor();
      // Web1.21.23 has no master-detail slot until an item is opened. A later
      // website's permanently blank right pane is not this baseline's behavior.
      metrics.activity = {
        emptyMainWidth: (
          await page.getByTestId("thread-main-column").boundingBox()
        ).width,
        visibleResizers: await page
          .locator(".cursor-col-resize")
          .filter({ visible: true })
          .count(),
      };
      assert.equal(metrics.activity.emptyMainWidth, 1383);
      assert.equal(metrics.activity.visibleResizers, 0);
      await page.mouse.move(1100, 100);
      await capture("activity-default");
      assert.deepEqual(run.errors, []);
      assert.ok(
        run.unbound.every((r) => r.path === "/api/billing/subscription"),
        JSON.stringify(run.unbound),
      );
      assert.deepEqual(
        run.consoleErrors.filter(
          (s) =>
            !s.startsWith("[Push] Failed to register service worker:") &&
            s !==
              "Failed to load resource: the server responded with a status of 501 (Not Implemented)",
        ),
        [],
      );
      report.arms[arm].writes = fixture.writes;
      report.arms[arm].gaps = run.unbound;
      report.arms[arm].errors = run.errors;
      report.arms[arm].consoleErrors = run.consoleErrors;
    } catch (error) {
      await page.screenshot({ path: out + "/failure-" + arm + ".png" });
      writeFileSync(
        out + "/failure.json",
        JSON.stringify(
          {
            arm,
            error: error.stack,
            body: await page.locator("body").innerText(),
            errors: run.errors,
            consoleErrors: run.consoleErrors,
            unbound: run.unbound,
            writes: fixture.writes,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(
    report.arms.reference.states,
    report.arms.loom.states,
    "UI outcomes diverged",
  );
  assert.deepEqual(
    report.arms.reference.metrics,
    report.arms.loom.metrics,
    "native geometry/resize behavior diverged",
  );
  for (const name of Object.keys(report.arms.reference.captures)) {
    const a = await sharp(readFileSync(report.arms.reference.captures[name]))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      b = await sharp(readFileSync(report.arms.loom.captures[name]))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { diff, ...stats } = comparePixels(a, b);
    report.pixels.push({ name, ...stats });
    if (stats.differingPixels)
      await sharp(diff, { raw: a.info })
        .png()
        .toFile(out + "/diff-" + name + ".png");
  }
  writeFileSync(out + "/report.json", JSON.stringify(report, null, 2) + "\n");
  assert.ok(
    report.pixels.every((r) => r.differingPixels === 0),
    "bilateral pixel mismatch",
  );
  console.log(
    JSON.stringify({
      pairs: report.pixels.length,
      geometry: report.arms.loom.metrics,
      writes: report.arms.loom.writes.length,
    }),
  );
} finally {
  await browser.close();
  await builds.close();
}
