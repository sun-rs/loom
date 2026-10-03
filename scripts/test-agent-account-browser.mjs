import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 844 },
    });
    let command;
    await page.route("**/v3/client/roles/create", async (route) => {
      command = route.request().postDataJSON();
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: "conflict",
            message: `Agent name "${command.configuration.handle}" is already taken`,
          },
        },
      });
    });
    await page.goto(fixture.origin + "/?surface=agents");
    await page.getByRole("button", { name: "创建 Role", exact: true }).click();
    await page.setViewportSize({ width, height: 844 });
    const dialog = page.getByRole("dialog", {
      name: "创建 Role",
      exact: true,
    });
    await dialog.locator("input").first().fill("KiMi");
    await dialog.getByRole("button", { name: /^运行时：/ }).click();
    await page.getByRole("menuitemradio").first().click();
    // The isolated fixture publishes only Fake runtime capabilities.
    const select = dialog.getByRole("button", { name: /^模型：/ });
    if (await select.count()) {
      await select.click();
      await page
        .getByRole("menuitemradio")
        .filter({ hasNotText: "自定义" })
        .first()
        .click();
    }
    await dialog
      .getByRole("button", { name: "保存 Role", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      'Agent name "KiMi" is already taken',
    );
    assert.equal(command.configuration.handle, "KiMi");
    const error = await dialog.getByRole("alert").boundingBox();
    const fields = await dialog.locator("fieldset label").first().boundingBox();
    assert.ok(error.y + error.height <= fields.y);
    await page.screenshot({ path: `/tmp/agent-account-conflict-${width}.png` });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    console.log("PASS case-preserving create and top conflict banner", width);
    await page.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}
