import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(
    fixture.origin + "/?room=" + fixture.roomId + "&surface=search&q=Council",
  );
  const result = page.locator(".rah-search-destination").first();
  await result.waitFor();
  await result.click();
  await page.goto(
    fixture.origin + "/?room=" + fixture.roomId + "&surface=search",
  );
  await page.getByRole("heading", { name: "搜索历史", exact: true }).waitFor();
  await page.locator(".rah-search-common").first().waitFor();
  assert.equal(
    (await page.locator(".rah-search-common").count()) > 0,
    true,
    "opened destination appears as common card",
  );
  const historyQuery = page
    .locator(".rah-search-history-tag > button:first-child")
    .first();
  await historyQuery.hover();
  await page.waitForTimeout(250);
  assert.equal(
    await historyQuery.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "query hover must not add a separate background over the shared history tag",
  );
  const remove = page.locator(".rah-search-history-remove").first();
  assert.equal(
    await remove.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  await remove.hover();
  await page.waitForTimeout(250);
  assert.equal(
    await remove.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgba(0, 0, 0, 0.1)",
  );
  await page.screenshot({ path: "/tmp/rah-search-history-delete-hover.png" });
  await page.setViewportSize({ width: 615, height: 844 });
  await page.getByRole("button", { name: "编辑", exact: true }).waitFor();
  const clear = page.getByRole("button", { name: "清除", exact: true });
  assert.deepEqual(
    await clear.evaluate((e) => ({
      font: getComputedStyle(e).fontSize,
      color: getComputedStyle(e).color,
    })),
    { font: "11px", color: "rgba(0, 0, 0, 0.45)" },
  );
  const positions = await page
    .locator(".filter-bar .task-filter-trigger")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().y));
  assert.ok(
    positions.every((y) => y === positions[0]),
    "615px filters fit one row",
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).waitFor();
  assert.ok(
    await page.locator(".rah-search-history-remove").first().isVisible(),
  );
  await page.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(
    await page.locator(".rah-search-history-remove").first().isVisible(),
    false,
  );
  await page.setViewportSize({ width: 560, height: 844 });
  const narrow = await page
    .locator(".filter-bar .task-filter-trigger")
    .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().y));
  assert.ok(narrow.at(-1) > narrow[0], "560px filters wrap naturally");
  await page.screenshot({ path: "/tmp/rah-search-narrow-560.png" });
  await page.setViewportSize({ width: 768, height: 900 });
  assert.equal(
    await page.getByRole("button", { name: "编辑", exact: true }).isVisible(),
    false,
  );
  console.log(
    "Search narrow edit, clear typography and filter wrapping passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
