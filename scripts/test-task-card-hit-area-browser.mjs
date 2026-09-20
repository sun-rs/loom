import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  for (const [width, view] of [
    [1440, "列表"],
    [1440, "看板"],
    [390, "列表"],
    [390, "看板"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`${fixture.origin}/?surface=tasks`);
    await page.getByRole("radio", { name: view, exact: true }).click();
    const card = page.locator(".rah-global-task-card").first();
    await expect(card).toBeVisible();
    for (const point of ["padding", "footer", "title"]) {
      const box = await card.boundingBox();
      if (point === "title") await card.locator(".kcard-title").click();
      else
        await page.mouse.click(
          box.x + 5,
          point === "padding" ? box.y + 5 : box.y + box.height - 9,
        );
      await expect(page.getByTestId("task-thread-modal")).toBeVisible({
        timeout: 2000,
      });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("task-thread-modal")).toHaveCount(0);
    }
    await card.getByRole("button", { name: /^任务 #\d+ 状态：/ }).click();
    await expect(page.getByRole("menuitemradio").first()).toBeVisible();
    await expect(page.getByTestId("task-thread-modal")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await card.locator(".rah-global-card-open").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-thread-modal")).toBeVisible();
    await page.close();
  }
  console.log(
    "One click opens task from padding, footer whitespace and title; status menu stays independent; keyboard opens at desktop/mobile widths",
  );
} finally {
  await browser.close();
  await fixture.close();
}
