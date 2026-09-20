import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  for (const cli of ["claude", "codex"]) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.route("**/v1/local/runtimes/list", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      for (const runtime of data.runtimes)
        if (runtime.configured) {
          runtime.cliId = cli;
          runtime.customModelRuntime = cli;
          runtime.displayName = cli === "claude" ? "Claude Code" : "Codex";
        }
      await route.fulfill({ response, json: data });
    });
    let saved;
    await page.route("**/v3/client/agents/manage", async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({
        status: 400,
        json: {
          error: { message: "Fixture captured explicit model selection" },
        },
      });
    });
    await page.goto(fixture.origin + "/?surface=agents");
    await page.locator(".rah-agent-member-row").first().click();
    await page
      .getByRole("button", { name: "编辑运行时配置", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "编辑运行时配置" });
    if (cli === "claude") {
      await dialog.getByRole("button", { name: /^模型：/ }).click();
      await expect(
        page.getByRole("menuitemradio", { name: /Claude Opus 5/ }),
      ).toBeVisible();
      await page.getByRole("menuitemradio", { name: /Claude Opus 5/ }).click();
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      await expect
        .poll(() => saved?.modelIntent?.customModel?.modelId)
        .toBe("claude-opus-5");
      assert.equal(saved.modelIntent.exactBindingIds, undefined);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
    }
    await dialog.getByRole("button", { name: /^模型：/ }).click();
    await page
      .getByRole("menuitemradio", { name: "自定义", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "自定义模型 ID", exact: true })
      .fill(`vendor/${cli}-special-v2`);
    await dialog
      .getByRole("button", { name: "保存运行时配置", exact: true })
      .click();

    await expect
      .poll(() => saved?.modelIntent?.customModel?.modelId)
      .toBe(`vendor/${cli}-special-v2`);
    await page.screenshot({ path: "/tmp/rah-custom-model-picker.png" });
    console.log("PASS", cli, "custom model save explicit native IDs");
    await page.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}
