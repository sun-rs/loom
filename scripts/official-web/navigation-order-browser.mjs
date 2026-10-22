import assert from "node:assert/strict";
export async function verifyNavigationOrder({ browser, origin }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(origin);
    await page.getByTestId("left-rail-tab-channels").waitFor();
    const order = () =>
      page
        .locator("[data-rail-tab-id]")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("data-rail-tab-id")),
        );
    const initial = await order();
    assert.equal(initial.length, 6);
    const url = page.url();
    await page.getByTestId("left-rail-tab-channels").focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    const moved = [initial[1], initial[0], ...initial.slice(2)];
    assert.deepEqual(await order(), moved);
    assert.equal(page.url(), url, "drag must not navigate");
    await page.reload();
    await page.getByTestId("left-rail-tab-channels").waitFor();
    assert.deepEqual(await order(), moved);
    const from = await page.getByTestId("left-rail-tab-channels").boundingBox();
    const to = await page.getByTestId("left-rail-tab-activity").boundingBox();
    await page.mouse.move(from.x + 20, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + 20, { steps: 12 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(200);
    assert.deepEqual(await order(), initial);
    assert.equal(page.url(), url);
    await page.getByTestId("left-rail-tab-channels").focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    assert.deepEqual(await order(), initial);
    await page.waitForTimeout(100); // Official cancellation suppresses the synthetic click until the next task.
    await page.getByTestId("left-rail-tab-tasks").click();
    assert.match(page.url(), /view=tasks/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.getByTestId("left-rail-tab-tasks").isVisible(),
      false,
    );
    assert.equal(await page.locator(".loom-mobile-nav").isVisible(), true);
    assert.deepEqual(errors, []);
    return {
      keyboard: true,
      pointer: true,
      cancel: true,
      persisted: true,
      mobile: true,
    };
  } finally {
    await context.close();
  }
}
