import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output =
  process.env.RAH_COMPUTER_RAIL_OUTPUT ?? "/tmp/rah-computer-rail-parity";
mkdirSync(output, { recursive: true });
const results = [];
const engines = (
  process.env.RAH_COMPUTER_RAIL_ENGINES ?? "chrome,firefox"
).split(",");
const scope = process.env.RAH_COMPUTER_RAIL_SCOPE ?? "all";
for (const engine of engines) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    // Controlled unavailable-state response in an already isolated Fake CLI fixture.
    await page.route("**/v1/local/runtimes/list", async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.runtimes[body.runtimes.length - 1].available = false;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${fixture.origin}/?surface=computers`);
    await page.locator(".rah-computer-row").first().click();
    const chips = page.locator(".rah-computer-runtime-chips > button");
    await chips.first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 598 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const label = `${engine}-${viewport.width}x${viewport.height}`;
      const chip = await chips.first().evaluate((el) => {
        const css = getComputedStyle(el),
          box = el.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          fontSize: css.fontSize,
          lineHeight: css.lineHeight,
          padding: css.padding,
          border: css.borderWidth,
          display: css.display,
          alignItems: css.alignItems,
        };
      });
      if (scope !== "rail") {
        assert.equal(chip.fontSize, "14px", label + " source text-sm");
        assert.equal(
          chip.lineHeight,
          "20px",
          label + " source text-sm line height",
        );
        assert.equal(chip.padding, "4px 10px", label + " source py-1 px-2.5");
        assert.equal(chip.height, 24, label + " source h-6");
        assert.equal(chip.border, "2px");
      }
      if (scope !== "rail") {
        const missing = page.locator(
          ".rah-computer-runtime-chips > span.is-missing",
        );
        assert.equal(await missing.count(), 1);
        const style = await missing.evaluate((el) => ({
          font: getComputedStyle(el).fontSize,
          height: el.getBoundingClientRect().height,
          border: getComputedStyle(el).borderColor,
          background: getComputedStyle(el).backgroundColor,
        }));
        assert.equal(style.font, "14px");
        assert.equal(style.height, 24);
        assert.equal(style.border, "rgba(0, 0, 0, 0.3)");
        assert.equal(style.background, "oklch(0.967 0.003 264.542)");
        await chips.first().click();
        const inspector = page.locator(
          '.rah-computer-runtime-inspector[role="dialog"]',
        );
        await inspector.waitFor();
        await inspector
          .getByRole("button", { name: "关闭 Runtime 详情", exact: true })
          .click();
        await inspector.waitFor({ state: "hidden" });
        await page.mouse.move(viewport.width - 15, 50);
      }
      let rail;
      if (viewport.width >= 768 && scope !== "chip") {
        rail = await page.locator(".rail").evaluate((el) => {
          const css = getComputedStyle(el),
            box = el.getBoundingClientRect();
          const rows = [...el.querySelectorAll(".rail-footer-item")].map(
            (row) => {
              const button = row.querySelector("button"),
                b = button.getBoundingClientRect(),
                r = row.getBoundingClientRect();
              return {
                label: button.getAttribute("aria-label"),
                slotHeight: r.height,
                y: b.y,
                height: b.height,
                width: b.width,
                bottom: b.bottom,
              };
            },
          );
          return { paddingBottom: css.paddingBottom, bottom: box.bottom, rows };
        });
        assert.equal(rail.paddingBottom, "8px", label + " source pb-2");
        assert.equal(
          rail.rows.length,
          3,
          label + " notifications/help/settings",
        );
        assert.match(rail.rows[0].label, /通知/);
        assert.equal(rail.rows[1].label, "帮助");
        assert.equal(rail.rows[2].label, "设置");
        assert.deepEqual(
          rail.rows.map((row) => row.slotHeight),
          [44, 44, 44],
        );
        assert.equal(
          rail.rows[0].height,
          40,
          "notification size-10 remains fixed at short height",
        );
        const regular = viewport.height <= 600 ? 36 : 40;
        assert.equal(rail.rows[1].height, regular);
        assert.equal(rail.rows[2].height, regular);
        assert.equal(rail.bottom - rail.rows[2].bottom, 8 + (44 - regular) / 2);
        const help = page.getByRole("button", { name: "帮助", exact: true });
        await help.hover();
        const popup = page.getByRole("dialog", {
          name: "帮助与资源",
          exact: true,
        });
        await popup.waitFor();
        await popup.hover();
        assert.equal(await popup.isVisible(), true);
        await page.screenshot({ path: join(output, `${label}-help.png`) });
        await page.mouse.move(700, 50);
        await popup.waitFor({ state: "hidden" });
        await help.focus();
        await page.keyboard.press("Enter");
        await popup.waitFor();
        await page.keyboard.press("Escape");
        await popup.waitFor({ state: "hidden" });
        assert.equal(
          await help.evaluate((el) => el === document.activeElement),
          true,
        );
        await help.click();
        await popup.waitFor();
        const newPage = context.waitForEvent("page");
        await popup
          .getByRole("link", { name: "本机操作指南", exact: true })
          .click();
        const guide = await newPage;
        await guide.waitForURL(
          (url) => url.pathname === "/help/local-workbench.html",
        );
        await guide.waitForLoadState("domcontentloaded");
        assert.equal(
          new URL(guide.url()).pathname,
          "/help/local-workbench.html",
        );
        assert.ok((await guide.locator("h1").textContent()).includes("本机"));
        await guide.close();
        await popup.waitFor({ state: "hidden" });
        await page.mouse.move(700, 50);
      }
      if (viewport.width === 390) {
        assert.equal(
          await page.locator(".rail").isVisible(),
          false,
          "mobile uses its existing navigation",
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      await page.screenshot({ path: join(output, `${label}.png`) });
      results.push({
        engine,
        viewport,
        dpr: await page.evaluate(() => devicePixelRatio),
        chip,
        rail,
      });
    }
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({ output, cases: results.length, status: "passed" }),
);
