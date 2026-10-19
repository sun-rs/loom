import assert from "node:assert/strict";
export async function verifyAgentProfile({
  browser,
  origin,
  role,
  instances,
  instanceNames,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${origin}/?view=agents&role=${role.roleId}`);
      const detail = page.getByTestId("loom-role-detail");
      await detail.getByTestId("loom-role-profile").waitFor();
      assert.equal(
        await detail.locator('input[aria-label="名称"]:visible').count(),
        0,
      );
      assert.ok(
        (await detail.getByTestId("loom-role-profile").innerText()).includes(
          role.configuration.instructions,
        ),
      );
      await detail
        .getByRole("button", { name: "编辑配置", exact: true })
        .click();
      await detail
        .getByLabel("名称", { exact: true })
        .fill("FIXTURE unsaved profile");
      await page.getByRole("tab", { name: "实例", exact: true }).click();
      await page.getByRole("tab", { name: "配置", exact: true }).click();
      assert.equal(
        await detail.getByLabel("名称", { exact: true }).inputValue(),
        "FIXTURE unsaved profile",
      );
      await detail
        .getByLabel("名称", { exact: true })
        .fill(role.configuration.displayName);
      await detail
        .getByRole("button", { name: "返回资料", exact: true })
        .click();
      await page.getByRole("tab", { name: "实例", exact: true }).click();
      await detail
        .getByRole("button", { name: new RegExp(instanceNames[0]) })
        .first()
        .click();
      const panel = page.getByTestId("profile-panel");
      await panel.waitFor();
      await panel.getByTestId("loom-instance-activity").waitFor();
      await panel.getByRole("tab", { name: "资料", exact: true }).click();
      await panel.getByTestId("loom-instance-profile").waitFor();
      assert.ok(
        (await panel.getByTestId("loom-instance-profile").innerText()).includes(
          role.configuration.instructions,
        ),
      );
      assert.equal(
        await panel
          .getByRole("tab", { name: "资料", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.waitForTimeout(200); // native tab highlight animation before visual evidence
      await page.screenshot({ path: `/tmp/loom-agent-profile-${width}.png` });
      if (width === 1440)
        assert.equal(Math.round((await panel.boundingBox()).width), 380);
      await panel
        .getByRole("button", {
          name: width === 390 ? "返回实例列表" : "关闭实例详情",
          exact: true,
        })
        .click();
      if (width === 1440) {
        const handle = page.getByTestId("agent-sidebar-resize");
        const box = await handle.boundingBox();
        assert.equal(
          Math.round(
            await detail.evaluate(
              (el) =>
                el.parentElement.previousElementSibling.getBoundingClientRect()
                  .width,
            ),
          ),
          240,
        );
        await page.mouse.move(box.x + box.width / 2, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + 650, box.y + 100);
        await page.mouse.up();
        assert.equal(
          Math.round(
            await detail.evaluate(
              (el) =>
                el.parentElement.previousElementSibling.getBoundingClientRect()
                  .width,
            ),
          ),
          320,
        );
        await detail
          .getByRole("button", { name: new RegExp(instanceNames[0]) })
          .first()
          .click();
        await panel.waitFor();
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        assert.equal(
          await detail.evaluate((el) => getComputedStyle(el).display),
          "none",
          "narrow usable content folds role detail using native profile container rule",
        );
        assert.ok(
          (await panel.boundingBox()).width > 600,
          "profile fills the remaining content instead of squeezing three columns",
        );
        await panel
          .getByRole("button", { name: "关闭实例详情", exact: true })
          .click();
        await page.setViewportSize({ width: 1440, height: 1000 });
        const next = await handle.boundingBox();
        await page.mouse.move(next.x + next.width / 2, next.y + 100);
        await page.mouse.down();
        await page.mouse.move(0, next.y + 100);
        await page.mouse.up();
        assert.equal(
          Math.round(
            await detail.evaluate(
              (el) =>
                el.parentElement.previousElementSibling.getBoundingClientRect()
                  .width,
            ),
          ),
          180,
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        roleProfile: true,
        instanceProfile: true,
        instanceActivity: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
