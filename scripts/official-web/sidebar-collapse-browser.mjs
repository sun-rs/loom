import assert from "node:assert/strict";
export async function verifySidebarCollapse({ browser, origin }) {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    for (const view of ["channels", "computers", "agents", "settings"]) {
      await page.goto(origin + "/?view=" + view);
      const toggle = page.getByTestId("left-rail-sidebar-toggle");
      await toggle.waitFor();
      const sidebar = page.locator("#app-sidebar");
      await sidebar.waitFor();
      assert.equal(await sidebar.count(), 1);
      const before = await sidebar.boundingBox();
      const main = page
        .locator(
          '[data-testid="loom-channel-app"] [data-slot="app-shell-main-slot"]:visible',
        )
        .first();
      const expanded = await main.boundingBox();
      assert.ok(
        expanded.x >= before.x + before.width - 2,
        JSON.stringify({ view, expanded, before }),
      );
      await toggle.click();
      await page.waitForTimeout(300);
      assert.equal(await sidebar.getAttribute("inert"), "");
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      const rect = await page
        .locator(
          '[data-testid="loom-channel-app"] [data-slot="app-shell-main-slot"]:visible',
        )
        .first()
        .boundingBox();
      assert.ok(rect.x < before.x + 10, JSON.stringify({ view, rect, before }));
      assert.equal(
        await main.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(r.left + 16, r.top + 20),
          );
        }),
        true,
        view + " collapsed content must be painted and hit-testable",
      );
      await page.reload();
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      assert.equal(await sidebar.getAttribute("inert"), null);
      assert.equal(await toggle.count(), 0);
      await page.setViewportSize({ width: 1440, height: 900 });
      await toggle.waitFor();
      await toggle.click();
      await page.waitForTimeout(300);
      const control = sidebar.locator("button:visible,input:visible").first();
      await control.focus();
      await page.keyboard.press(
        (await page.evaluate(() =>
          /Mac|iPhone|iPad|iPod/.test(navigator.platform),
        ))
          ? "Meta+Backslash"
          : "Control+Backslash",
      );
      await page.waitForTimeout(300);
      assert.equal(
        await toggle.evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(await sidebar.getAttribute("inert"), "");
      await toggle.click();
    }
    await page.goto(origin + "/?view=tasks");
    await page.getByTestId("left-rail-tab-tasks").waitFor();
    assert.equal(await page.getByTestId("left-rail-sidebar-toggle").count(), 0);
    assert.deepEqual(errors, []);
    return {
      pages: 4,
      persistence: true,
      mobileRecovery: true,
      focus: true,
      nonSidebarPage: true,
    };
  } finally {
    await context.close();
  }
}
