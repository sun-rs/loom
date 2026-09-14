import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(10000);
  await page.goto(fixture.origin + "/?room=" + fixture.roomId);
  await page.locator("label").filter({ hasText: "作为任务" }).click();
  const composer = page.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  await composer.fill("Location invariant root");
  await composer.press("Enter");
  const root = page
    .locator(".channel .msg")
    .filter({ hasText: "Location invariant root" })
    .first();
  await root.waitFor();
  await root.hover();
  await root
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  const reply = page.getByRole("textbox", {
    name: "Thread 回复输入框",
    exact: true,
  });
  await reply.fill("Location invariant reply");
  await reply.press("Enter");
  const replyCard = page
    .locator(".thread .msg")
    .filter({ hasText: "Location invariant reply" })
    .first();
  await replyCard.waitFor();
  const messageId = await replyCard.getAttribute("data-message-id");
  async function assertFocused(label, query, id = messageId, input = reply) {
    const card = page
      .locator(`.msg[data-message-id="${id}"][data-focused="true"]`)
      .first();
    await card.waitFor();
    const style = await card.evaluate((e) => {
      const s = getComputedStyle(e);
      const swatch = document.createElement("span");
      swatch.style.background = "color-mix(in srgb, var(--cyan) 25%, white)";
      e.append(swatch);
      const blue =
        s.backgroundColor === getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return {
        blue,
        border: s.borderTopWidth,
        outline: s.outlineStyle,
        shadow: s.boxShadow !== "none",
      };
    });
    assert.deepEqual(
      style,
      { blue: true, border: "2px", outline: "none", shadow: true },
      label,
    );
    assert.equal(
      await page.getByText("已定位原消息及前后文", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "返回最新消息", exact: true })
        .count(),
      0,
    );
    if (query) await expect(card.locator("mark")).toContainText([query]);
    await card.hover();
    await page.mouse.wheel(0, 50);
    await expect(card).toHaveAttribute("data-focused", "true");
    if (query) await expect(card.locator("mark")).toContainText([query]);
    await card.screenshot({
      path: `/tmp/rah-location-${label}-${process.env.RAH_BROWSER ?? "chrome"}.png`,
    });
    const url = page.url();
    await input.click();
    await expect(page.locator('.msg[data-focused="true"]')).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(
      page.locator(`.msg[data-message-id="${id}"] mark`),
    ).toHaveCount(0);
    assert.equal(
      page.url(),
      url,
      "dismissal does not change the navigation target",
    );
  }
  await page.goto(fixture.origin + "/?surface=activity");
  await page
    .locator(".rah-activity-open")
    .filter({ hasText: "Location invariant reply" })
    .click();
  await assertFocused("activity");
  await page.goto(fixture.origin + "/?surface=search");
  await page
    .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
    .fill("Location invariant reply");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Location invariant reply" })
    .first()
    .click();
  await assertFocused("global-search", "Location invariant reply");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Location invariant reply" })
    .first()
    .click();
  await assertFocused("global-repeat", "Location invariant reply");
  await page.reload();
  await assertFocused("global-reload", "Location invariant reply");
  await page.goto(fixture.origin + "/?room=" + fixture.roomId);
  await page.getByRole("button", { name: "搜索当前对话", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
    .fill("Location invariant reply");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Location invariant reply" })
    .first()
    .click();
  await assertFocused("channel-search", "Location invariant reply");
  await page.goto(fixture.origin + "/?surface=search");
  await page
    .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
    .fill("Location invariant root");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Location invariant root" })
    .first()
    .click();
  const focusedRoot = page
    .locator('.channel .msg[data-focused="true"]')
    .first();
  await focusedRoot.waitFor();
  await assertFocused(
    "root-search",
    "Location invariant root",
    await focusedRoot.getAttribute("data-message-id"),
    composer,
  );
  await page.goto(fixture.origin + "/?room=" + fixture.roomId);
  const directRow = page.locator(".rah-direct-room-row").first();
  await directRow.click();
  await expect(directRow).toHaveClass(/is-selected/);
  await expect(composer).toBeEnabled();
  const taskToggle = page.getByRole("checkbox", {
    name: "作为任务",
    exact: true,
  });
  if (await taskToggle.isVisible()) await taskToggle.uncheck();
  await composer.fill("Location invariant direct");
  await composer.press("Enter");
  await page
    .locator(".channel .msg")
    .filter({ hasText: "Location invariant direct" })
    .first()
    .waitFor();
  await page.goto(fixture.origin + "/?surface=search");
  await page
    .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
    .fill("Location invariant direct");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Location invariant direct" })
    .first()
    .click();
  const focusedDirect = page
    .locator('.channel .msg[data-focused="true"]')
    .first();
  await focusedDirect.waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertFocused(
    "direct-search-mobile",
    "Location invariant direct",
    await focusedDirect.getAttribute("data-message-id"),
    composer,
  );
  console.log(
    "Task-backed Activity and global Search locate the exact reply with blue focus, no banner, including reload",
  );
} finally {
  await browser.close();
  await fixture.close();
}
