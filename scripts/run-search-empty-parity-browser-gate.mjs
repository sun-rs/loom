import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

// Official 2026-09-08 Search: no filter reset for a query alone; the empty
// result names the query. Use real local search in an isolated fixture.
const output = mkdtempSync(join(tmpdir(), "rah-search-empty-parity-"));
const results = [];
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      serviceWorkers: "block",
    });
    page.setDefaultTimeout(10_000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const query = "qzxvnb873619efc204a";
      await page.goto(
        `${fixture.origin}/?surface=search&q=${query}&sort=recent`,
      );
      await page
        .locator(
          '.rah-empty-state[data-context="search"][data-placement="section"]',
        )
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "清除筛选", exact: true })
          .count(),
        0,
        "A query alone is not an active filter in the official Search",
      );
      await page
        .getByText(`没有找到“${query}”的结果`, { exact: true })
        .waitFor();
      await page
        .getByText("试试其他关键词或更短的短语。", { exact: true })
        .waitFor();
      await page.screenshot({
        path: join(output, `${engine}-${width}-empty.png`),
      });
      await page.getByRole("button", { name: "不限时间", exact: true }).click();
      await page
        .getByRole("menuitemradio", { name: "今天", exact: true })
        .click();
      const reset = page.getByRole("button", { name: "清除筛选", exact: true });
      await reset.waitFor();
      await reset.click();
      await reset.waitFor({ state: "detached" });
      assert.equal(new URL(page.url()).searchParams.get("q"), query);
      assert.equal(
        new URL(page.url()).searchParams.get("sort"),
        "recent",
        "Clearing filters preserves the independently selected sort order",
      );
      assert.equal(new URL(page.url()).searchParams.has("time"), false);
      await page.reload();
      await page
        .getByText(`没有找到“${query}”的结果`, { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "清除筛选", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
      );
      results.push({
        engine,
        width,
        empty: true,
        conditionalReset: true,
        queryPreserved: true,
        reload: true,
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "receipt.json"),
  JSON.stringify({ fixture: true, results }, null, 2),
);
console.log(`RAH_SEARCH_EMPTY_PARITY ${JSON.stringify({ output, results })}`);
