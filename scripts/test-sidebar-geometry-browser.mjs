import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-sidebar-geometry-`);
const failures = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const verify = async (name, fn) => {
      try {
        await fn();
      } catch (error) {
        failures.push(`${width} ${name}: ${error}`);
      }
    };
    await page.goto(fixture.origin);
    const sidebar = page.locator(".rah-room-sidebar");
    const groups = sidebar.locator("[data-sidebar-group]");
    const channel = sidebar.locator('[data-sidebar-group="channels"]');
    await expect(channel).toBeVisible();
    await verify("occupancy-defaults", async () => {
      await expect(channel.locator("[data-sidebar-key]").nth(1)).toBeVisible();
      await expect(
        sidebar
          .locator('[data-sidebar-group="dms"] [data-sidebar-key]')
          .first(),
      ).toBeVisible();
      for (const group of await groups.all()) {
        const toggle = group.locator(".rah-sidebar-disclosure");
        const count = Number(await toggle.locator(".count").innerText());
        await expect(toggle).toHaveAttribute(
          "aria-expanded",
          String(count > 0),
        );
      }
      const pinned = sidebar.locator(
        '[data-sidebar-group="pinned"] .rah-sidebar-disclosure',
      );
      const keys = await channel
        .locator("[data-sidebar-key]")
        .evaluateAll((es) =>
          es.slice(0, 2).map((e) => e.getAttribute("data-sidebar-key")),
        );
      assert.equal(keys.length, 2);
      const pin = async (key) => {
        const row = sidebar.locator(`[data-sidebar-key="${key}"]`);
        await expect(row).toHaveAttribute("aria-disabled", "false");
        const saved = page.waitForResponse((r) =>
          r.url().endsWith("/sidebar/patch"),
        );
        await row.focus();
        await page.keyboard.press("Alt+p");
        assert.equal((await saved).status(), 200);
        await expect(row).toHaveAttribute("aria-disabled", "false");
      };
      await pin(keys[0]);
      await expect(pinned).toHaveAttribute("aria-expanded", "true");
      await pinned.click();
      await pin(keys[1]);
      await expect(pinned.locator(".count")).toHaveText("2");
      await expect(pinned).toHaveAttribute("aria-expanded", "false");
      await page.waitForTimeout(5200);
      await expect(pinned).toHaveAttribute("aria-expanded", "false");
      await pinned.click();
      await pin(keys[1]);
      await pin(keys[0]);
      await expect(pinned).toHaveAttribute("aria-expanded", "true");
      await pin(keys[0]);
      await expect(pinned).toHaveAttribute("aria-expanded", "true");
      await pin(keys[0]);
      await expect(pinned).toHaveAttribute("aria-expanded", "true");
    });
    await verify("row-density", async () => {
      for (const row of await sidebar.locator(".channel-row, .dm-row").all())
        await expect(row).toHaveCSS(
          "margin-bottom",
          width === 390 ? "2px" : "4px",
        );
      if (width === 390) {
        const row = channel.locator(".channel-row").first();
        await expect(row).toHaveCSS("padding-top", "4px");
        assert.equal((await row.boundingBox()).height, 32);
      }
    });
    await verify("type-scale", async () => {
      for (const selector of [".rah-sidebar-disclosure", ".count"])
        for (const node of await sidebar.locator(selector).all())
          await expect(node).toHaveCSS("font-size", "12px");
      for (const selector of [
        ".sidebar-bookmarks",
        ".rah-sidebar-channel-name",
        ".rah-direct-row-name",
      ])
        for (const node of await sidebar.locator(selector).all())
          await expect(node).toHaveCSS("font-size", "14px");
      await expect(
        sidebar.locator(".rah-sidebar-disclosure").first(),
      ).toHaveCSS("line-height", "16px");
      for (const node of await sidebar.locator(".channel-row, .dm-row").all())
        await expect(node).toHaveCSS("line-height", "20px");
    });
    await verify("action-geometry", async () => {
      const sort = channel.getByRole("button", {
        name: "频道排序",
        exact: true,
      });
      const plus = channel.getByRole("button", {
        name: "新建频道",
        exact: true,
      });
      const boxes = await Promise.all([sort, plus].map((b) => b.boundingBox()));
      for (const box of boxes) {
        assert.equal(box.width, 24);
        assert.equal(box.height, 24);
      }
      const icons = await Promise.all(
        [sort, plus].map((b) => b.locator("svg").first().boundingBox()),
      );
      for (const [index, icon] of icons.entries()) {
        assert.equal(icon.width, 14);
        assert.equal(icon.height, 14);
        assert.equal(
          icon.y + icon.height / 2,
          boxes[index].y + boxes[index].height / 2,
        );
      }
      assert.equal(icons[0].y, icons[1].y);
      assert.equal(boxes[1].x - boxes[0].x - boxes[0].width, 4);
    });
    await channel.locator(".rah-sidebar-disclosure").click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "新建分区…", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "新建分区", exact: true });
    await dialog.getByPlaceholder("我的项目").fill("Geometry fixture");
    await dialog.getByRole("button", { name: "创建分区", exact: true }).click();
    await expect(groups).toHaveCount(width === 1440 ? 4 : 5);
    const custom = groups
      .filter({ has: page.getByText("Geometry fixture", { exact: true }) })
      .last();
    await verify("empty-content", async () => {
      const hint = sidebar.locator('[data-sidebar-group="pinned"] .side-hint');
      await expect(hint).toBeVisible();
      await expect(custom.locator(".side-hint")).toBeHidden();
      await custom.locator(".rah-sidebar-disclosure").click();
      assert.equal((await hint.boundingBox()).height, 36);
      await expect(hint).toHaveCSS("padding-top", "6px");
      await expect(hint).toHaveCSS("margin-bottom", "4px");
      assert.equal(
        (await custom.locator(".side-hint").boundingBox()).height,
        28,
      );
    });
    await page.screenshot({ path: `${evidence}/${width}-expanded.png` });
    for (const group of await groups.all()) {
      const toggle = group.locator(".rah-sidebar-disclosure");
      if ((await toggle.getAttribute("aria-expanded")) === "true")
        await toggle.click();
    }
    await verify("collapsed-spacing", async () => {
      const headers = await sidebar
        .locator("[data-sidebar-group] .side-title")
        .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON()));
      const saved = await sidebar
        .getByRole("button", { name: "已保存", exact: true })
        .boundingBox();
      assert.equal(
        headers[0].y - saved.y - saved.height,
        width === 390 ? 12 : 16,
      );
      for (let i = 1; i < headers.length; i++)
        assert.equal(
          headers[i].y - headers[i - 1].y - headers[i - 1].height,
          width === 390 ? 12 : 16,
        );
    });
    await page.screenshot({ path: `${evidence}/${width}-collapsed.png` });
    const sort = channel.getByRole("button", { name: "频道排序", exact: true });
    await sort.click();
    await expect(sort).toHaveAttribute("aria-expanded", "true");
    await sort.click();
    await expect(sort).toHaveAttribute("aria-expanded", "false");
    await expect(channel.locator(".rah-sidebar-disclosure")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await channel
      .getByRole("button", { name: "新建频道", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "创建频道", exact: true }),
    ).toBeVisible();
    await page.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
