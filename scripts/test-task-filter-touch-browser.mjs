import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-task-filter-touch-`);
const failures = [];
try {
  for (const width of [390, 430, 1440]) {
    const mobile = width < 768;
    const page = await browser.newPage({
      viewport: { width, height: mobile ? 844 : 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    page.setDefaultTimeout(10000);
    async function check(name, fn) {
      try {
        await fn();
      } catch (e) {
        failures.push(`${width} ${name}: ${e.message}`);
      }
    }
    await page.goto(`${fixture.origin}/?room=${fixture.roomId}&roomTab=tasks`);
    const toolbar = page.locator('.tasks-toolbar[data-task-scope="room"]');
    const creator = toolbar.getByRole("button", { name: /^创建者/ });
    const assignee = toolbar.getByRole("button", { name: /^负责人/ });
    const create = toolbar.getByRole("button", {
      name: "新建任务",
      exact: true,
    });
    await expect(create).toBeEnabled();
    if (mobile)
      await check("equal toolbar vertical clearance", async () => {
        const space = await toolbar.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const button = el
            .querySelector(".rah-task-create")
            .getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            top: button.top - rect.top - parseFloat(style.borderTopWidth),
            bottom:
              rect.bottom - button.bottom - parseFloat(style.borderBottomWidth),
          };
        });
        assert.ok(
          Math.abs(space.top - space.bottom) <= 0.5,
          JSON.stringify(space),
        );
      });
    const gray = await creator.evaluate(
      (el) => getComputedStyle(el).borderTopColor,
    );
    for (const [label, trigger] of [
      ["创建者", creator],
      ["负责人", assignee],
    ]) {
      await check(`${label} toggle border`, async () => {
        if (mobile) await trigger.tap();
        else await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(trigger).toHaveCSS(
          "border-top-color",
          /^(?:rgb\(0, 0, 0\)|oklch\(0 0 0\))$/,
        );
        if (mobile) await trigger.tap();
        else await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(
          page.getByRole("menu", { name: `${label}筛选` }),
        ).toHaveCount(0);
        if (mobile) await expect(trigger).toHaveCSS("border-top-color", gray);
        else {
          await expect(trigger).toHaveCSS(
            "border-top-color",
            /^(?:rgb\(0, 0, 0\)|oklch\(0 0 0\))$/,
          );
          await page.mouse.move(0, 0);
          await expect(trigger).toHaveCSS("border-top-color", gray);
        }
        if (mobile) await trigger.tap();
        else await trigger.click();
        await (mobile
          ? page.locator(".rah-conversation-head").tap()
          : page.locator(".rah-conversation-head").click());
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toHaveCSS("border-top-color", gray);
      });
    }
    await check("selected spacing", async () => {
      for (const trigger of [creator, assignee]) {
        await trigger.click();
        await page.getByRole("menuitemcheckbox").first().click();
        await page.keyboard.press("Escape");
      }
      await expect(creator).toHaveCSS("border-top-width", "2px");
      await expect(creator).toHaveCSS(
        "border-top-color",
        /^(?:rgb\(0, 0, 0\)|oklch\(0 0 0\))$/,
      );
      if (mobile) {
        const a = await creator.boundingBox(),
          b = await assignee.boundingBox(),
          c = await create.boundingBox();
        assert.ok(
          b.x - a.x - a.width >= 6,
          "Shared mobile gap leaves room around the 2px selected shadow",
        );
        assert.ok(
          c.x - b.x - b.width >= 6,
          "create does not touch the assignee shadow",
        );
        assert.equal(a.y, b.y);
        assert.equal(b.y, c.y);
        const view = await toolbar.locator(".tasks-view").boundingBox();
        if (view.x + view.width > width - 8) {
          await expect(toolbar.locator(".tasks-toolbar-row")).toHaveCSS(
            "overflow-x",
            "auto",
          );
          await toolbar
            .getByRole("radio", { name: "列表", exact: true })
            .click();
          await expect(
            toolbar.getByRole("radio", { name: "列表", exact: true }),
          ).toBeInViewport();
        }
        assert.equal(view.y, c.y);
        await expect(toolbar.locator(".task-filter-count")).toHaveCount(2);
      }
      await page.screenshot({ path: `${evidence}/${width}-selected.png` });
    });
    if (mobile)
      await check("global popup border", async () => {
        await page.goto(`${fixture.origin}/?surface=tasks`);
        const global = page.locator(
          '.rah-discovery[aria-label="全局任务"] .tasks-toolbar',
        );
        await expect(global).toBeVisible();
        const insets = await global.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            b = el
              .querySelector(".task-filter-trigger")
              .getBoundingClientRect();
          return [
            b.top - r.top,
            r.bottom -
              b.bottom -
              parseFloat(getComputedStyle(el).borderBottomWidth),
          ];
        });
        assert.deepEqual(insets, [10, 10]);
        for (const label of ["频道", "创建者", "负责人"]) {
          const trigger = page
            .getByRole("main", { name: "全局任务" })
            .getByRole("button", { name: label, exact: true });
          await expect(trigger).toBeEnabled();
          await trigger.tap();
          await trigger.tap();
          await expect(trigger).toHaveAttribute("aria-expanded", "false");
          await expect(trigger).toHaveCSS("border-top-color", gray);
        }
      });
    await page.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
