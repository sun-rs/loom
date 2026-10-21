import assert from "node:assert/strict";
export async function verifyRegionSettings({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      locale: "zh-CN",
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings");
      const labels = await page
        .getByTestId("loom-settings-sidebar")
        .innerText();
      assert.ok(
        labels.indexOf("账户") < labels.indexOf("语言和区域") &&
          labels.indexOf("语言和区域") < labels.indexOf("外观"),
        "region tab belongs between account and appearance",
      );
      await page.getByText("语言和区域", { exact: true }).click();
      await page.getByTestId("region-date-form").waitFor();
      assert.equal(
        await page
          .getByTestId("region-date-form")
          .getByRole("button", { name: "保存", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page.getByTestId("display-language-select").isDisabled(),
        true,
      );

      assert.notEqual(
        (
          await page
            .getByTestId("region-date-form")
            .getByRole("combobox")
            .innerText()
        ).trim(),
        "时区",
        "default timezone must display effective browser region",
      );
      assert.equal(
        await page
          .getByTestId("loom-settings-sidebar")
          .getByText("运行设置", { exact: true })
          .count(),
        0,
      );
      await page.getByTestId("region-date-form").getByRole("combobox").click();
      await page.getByRole("option").filter({ hasText: "UTC" }).first().click();
      await page.getByTestId("time-format-12h").click();
      const form = page.getByTestId("region-date-form");
      const save = form.getByRole("button", { name: "保存", exact: true });
      if (await save.isEnabled()) await save.click();
      await page.reload();
      await page.getByTestId("time-format-12h").waitFor();
      assert.equal(
        await page.getByTestId("time-format-12h").getAttribute("aria-checked"),
        "true",
      );
      await page.getByTestId("time-format-24h").click();
      await save.click();
      await page.reload();
      assert.equal(
        await page.getByTestId("time-format-24h").getAttribute("aria-checked"),
        "true",
      );
      await page.goto(origin + "/?view=settings&settings=administration");
      await page.getByText("运行设置", { exact: true }).waitFor();
      await page
        .getByTestId("loom-settings-sidebar")
        .getByText("管理", { exact: true })
        .waitFor({ state: width === 390 ? "hidden" : "visible" });
      await page.goto(origin + "/?view=settings&settings=server");
      await page.getByText("运行设置", { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("heading", { name: "管理", exact: true }).count(),
        1,
      );
      if (width === 1440) {
        await page.goto(origin + "/?view=computers");
        const header = page.getByTestId("computer-section-header");
        await header.waitFor();
        assert.ok((await header.innerText()).includes("计算机"));
        const computer = await header.evaluate((e) => ({
          paddingTop: getComputedStyle(e).paddingTop,
          y: e.getBoundingClientRect().top,
        }));
        await page.goto(origin + "/?view=agents");
        const agent = await page
          .locator(
            '[data-testid="loom-role-list"] [data-slot="sidebar-section-header"]',
          )
          .first()
          .evaluate((e) => ({
            paddingTop: getComputedStyle(e).paddingTop,
            y: e.getBoundingClientRect().top,
          }));
        assert.deepEqual(agent, computer);
        results.push({ width, computer, agent });
      } else results.push({ width });
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    } finally {
      await context.close();
    }
  }
  return results;
}
