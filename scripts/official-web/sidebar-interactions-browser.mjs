import assert from "node:assert/strict";
// FIXTURE ONLY. Exercise real pointer/keyboard entry points, never a hidden menu button.
export async function verifySidebarInteractions(page) {
  const sidebar = page.getByTestId("public-server-channel-sidebar-root");
  const heading = page
    .locator('[data-sidebar-section="channels"]')
    .getByRole("button", { name: "频道", exact: true });
  await heading.waitFor();
  assert.equal(await sidebar.getByText("频道", { exact: true }).count(), 1);
  assert.equal(
    await sidebar.locator(".lucide-ellipsis, .lucide-more-horizontal").count(),
    0,
  );
  assert.equal(await heading.getAttribute("aria-expanded"), "true");
  const sort = page.getByRole("button", { name: "排序 频道", exact: true });
  assert.equal(await sort.locator(".lucide-arrow-up-down").count(), 1);
  assert.equal(
    await page
      .getByRole("button", { name: "新建频道", exact: true })
      .first()
      .locator(".lucide-plus")
      .count(),
    1,
  );
  await sort.click();
  await page
    .getByRole("menuitem", { name: "按名称排序", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (el) => el === document.activeElement,
    await sort.elementHandle(),
  );
  assert.equal(
    await sort.evaluate((el) => el === document.activeElement),
    true,
  );
  const row = sidebar.locator("[data-public-channel-id]").first();
  const id = await row.getAttribute("data-public-channel-id");
  const url = page.url();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^(置顶|取消置顶)$/ }).waitFor();
  assert.equal(page.url(), url);
  const box = await page.getByRole("menu").boundingBox();
  assert.ok(
    box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= page.viewportSize().width + 1 &&
      box.y + box.height <= page.viewportSize().height + 1,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: /^(置顶|取消置顶)$/ }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (el) => el === document.activeElement,
    await row.elementHandle(),
  );
  assert.equal(await row.evaluate((el) => el === document.activeElement), true);
  await heading.click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建分组", exact: true }).waitFor();
  await page.mouse.click(page.viewportSize().width - 10, 10);
  await page.getByRole("menu").waitFor({ state: "hidden" });
  // The menu trigger supports native touch long-press without adding a row button.
  const cdp = await page.context().newCDPSession(page);
  const target = await row.boundingBox();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: target.x + target.width / 2, y: target.y + target.height / 2 },
    ],
  });
  await page.getByRole("menuitem", { name: /^(置顶|取消置顶)$/ }).waitFor();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.keyboard.press("Escape");
  await cdp.detach();
  assert.equal(await row.getAttribute("data-public-channel-id"), id);
}
