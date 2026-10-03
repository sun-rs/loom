import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { roleBrowserFixture } from "./role-browser-fixture.mjs";
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
    const f = await roleBrowserFixture(page, fixture);
    const role = await f.createRole(`Custom${cli}`);
    let saved;
    await page.route("**/v3/client/roles/revise", async (route) => {
      saved = route.request().postDataJSON().configuration;
      await route.fulfill({
        status: 400,
        json: {
          error: { message: "Fixture captured explicit model selection" },
        },
      });
    });
    await page.goto(fixture.origin + "/?surface=agents");
    await page
      .getByRole("button", {
        name: role.configuration.displayName,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "编辑配置", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑 Role 配置" });
    if (cli === "claude") {
      await dialog.getByRole("button", { name: /^模型：/ }).click();
      await expect(
        page.getByRole("menuitemradio", { name: /Claude Opus 5/ }),
      ).toBeVisible();
      await page.getByRole("menuitemradio", { name: /Claude Opus 5/ }).click();
      await dialog.getByRole("button", { name: /^推理强度：/ }).click();
      await page
        .getByRole("menuitemradio", { name: "High", exact: true })
        .click();
      await expect(
        dialog.getByText(
          "可按模型文档选择推理强度；当前 CLI 与账户支持尚未验证。",
        ),
      ).toBeVisible();
      await dialog
        .getByRole("button", { name: "保存修订", exact: true })
        .click();
      await expect
        .poll(() => saved?.modelIntent?.customModel?.modelId)
        .toBe("claude-opus-5");
      assert.equal(saved.modelIntent.exactBindingIds, undefined);
      assert.equal(saved.modelIntent.reasoning, "high");
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "编辑配置", exact: true }).click();
    }
    await dialog.getByRole("button", { name: /^模型：/ }).click();
    await page
      .getByRole("menuitemradio", { name: "自定义", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "自定义模型 ID", exact: true })
      .fill(`vendor/${cli}-special-v2`);
    await dialog.getByRole("button", { name: "保存修订", exact: true }).click();

    await expect
      .poll(() => saved?.modelIntent?.customModel?.modelId)
      .toBe(`vendor/${cli}-special-v2`);
    await page.screenshot({ path: "/tmp/rah-custom-model-picker.png" });
    console.log("PASS", cli, "custom model save explicit native IDs");
    if (cli === "claude") {
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByRole("button", { name: "创建 Role", exact: true })
        .click();
      const create = page.getByRole("dialog", {
        name: "创建 Role",
        exact: true,
      });
      let created;
      await page.route("**/v3/client/roles/create", async (route) => {
        created = route.request().postDataJSON();
        await route.fulfill({
          status: 400,
          json: { error: { message: "Fixture captured creation" } },
        });
      });
      await create
        .getByRole("textbox", { name: /名称/ })
        .fill("Effort Fixture");
      await create.getByRole("button", { name: /^运行时：/ }).click();
      await page.getByRole("menuitemradio").first().click();
      await create.getByRole("button", { name: /^模型：/ }).click();
      await page
        .getByRole("menuitemradio", { name: "Claude Sonnet 5", exact: true })
        .click();
      await create.getByRole("button", { name: /^推理强度：/ }).click();
      await expect(
        page.getByRole("menuitemradio", { name: "默认", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("menuitemradio", { name: "High", exact: true }),
      ).toContainText("针对复杂问题提供更深入的推理");
      await expect(
        page.getByRole("menuitemradio", { name: "Ultra", exact: true }),
      ).toHaveCount(0);

      await page
        .getByRole("menuitemradio", { name: "High", exact: true })
        .click();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(
          create.getByText(
            "可按模型文档选择推理强度；当前 CLI 与账户支持尚未验证。",
          ),
        ).toBeVisible();
        await create
          .getByRole("button", { name: /^推理强度：High/ })
          .scrollIntoViewIfNeeded();
        await create.getByRole("button", { name: /^推理强度：High/ }).click();
        const high = page.getByRole("menuitemradio", {
          name: "High",
          exact: true,
        });
        await expect(high).toContainText("针对复杂问题提供更深入的推理");
        await high.scrollIntoViewIfNeeded();
        const description = high.locator("small");
        await expect(description).toBeVisible();
        assert.equal(
          await description.evaluate((e) => getComputedStyle(e).fontSize),
          "12px",
        );
        await page.screenshot({ path: `/tmp/effort-description-${width}.png` });
        await page.keyboard.press("Escape");
      }
      await create
        .getByRole("button", { name: "保存 Role", exact: true })
        .click();
      await expect
        .poll(() => created?.configuration?.modelIntent?.reasoning)
        .toBe("high");
      assert.equal(
        created.configuration.modelIntent.customModel.modelId,
        "claude-sonnet-5",
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  await fixture.close();
}
