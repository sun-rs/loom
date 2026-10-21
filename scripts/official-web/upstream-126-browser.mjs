import assert from "node:assert/strict";
export async function verifyUpstream126({ browser, origin, role, client }) {
  const results = [];
  const before = await client.request("role.list", {
    controlRoomId: role.controlRoomId,
  });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${origin}/?view=agents&role=${role.roleId}`);
      const profile = page.getByTestId("loom-role-profile");
      await profile.waitFor();
      await page.getByRole("tab", { name: "资料", exact: true }).waitFor();
      const token = await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--text-body")
          .trim(),
      );
      assert.equal(token, width === 1440 ? "14px" : "16px");
      await profile
        .getByRole("button", { name: "编辑名称", exact: true })
        .click();
      assert.equal(
        await profile.getByLabel("角色 Prompt", { exact: true }).count(),
        0,
      );
      const name = `FIXTURE field profile ${width}`;
      await profile.getByLabel("名称", { exact: true }).fill(name);
      await profile.getByRole("button", { name: "保存", exact: true }).click();
      await profile
        .getByRole("button", { name: "保存", exact: true })
        .waitFor({ state: "hidden" });
      await profile
        .getByRole("button", { name: "编辑名称", exact: true })
        .waitFor();
      await page.reload();
      await profile.waitFor();
      assert.ok((await profile.innerText()).includes(name));
      await profile
        .getByRole("button", { name: "编辑角色 Prompt", exact: true })
        .click();
      await profile
        .getByLabel("角色 Prompt", { exact: true })
        .fill(`FIXTURE prompt ${width}`);
      await profile.getByRole("button", { name: "保存", exact: true }).click();
      await profile
        .getByRole("button", { name: "保存", exact: true })
        .waitFor({ state: "hidden" });
      await profile
        .getByRole("button", { name: "编辑模型", exact: true })
        .click();
      await profile.getByRole("button", { name: "取消", exact: true }).click();
      await profile
        .getByRole("button", { name: "更换头像", exact: true })
        .click();
      const avatar = profile
        .getByRole("button", { name: /^头像 / })
        .nth(width === 1440 ? 1 : 2);
      await avatar.click();
      const key = (await avatar.getAttribute("aria-label")).slice(3);
      await profile.getByRole("button", { name: "保存", exact: true }).click();
      await profile
        .getByRole("button", { name: "保存", exact: true })
        .waitFor({ state: "hidden" });
      await profile
        .getByRole("button", { name: "编辑名称", exact: true })
        .waitFor();
      await page.reload();
      await profile.waitFor();
      const catalog = await client.request("role.list", {
        controlRoomId: role.controlRoomId,
      });
      const saved = catalog.roles.find((r) => r.roleId === role.roleId);
      assert.equal(saved.configuration.avatarKey, `pixel:${key}`);
      assert.equal(saved.configuration.instructions, `FIXTURE prompt ${width}`);
      assert.deepEqual(
        catalog.instances,
        before.instances.map((i) => ({ ...i, isCurrent: false })),
        "Existing instances retain revision IDs and become out of date",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: `/tmp/loom-126-role-${width}.png` });
      if (width === 1440) {
        for (const w of [1440, 1024, 768, 1440]) {
          await page.setViewportSize({ width: w, height: 844 });
          await page.waitForTimeout(100);
          const b = await page.getByTestId("app-top-bar-search").boundingBox();
          assert.ok(b.width >= 360 && b.width <= 521);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
        }
      }
      await page.goto(`${origin}/?view=computers`);
      await page
        .getByTestId(
          width >= 768 ? "computer-desktop-row" : "computer-mobile-row",
        )
        .click();
      const group = page
        .getByTestId("computer-instances")
        .locator('[data-slot="list-row-group"]');
      await group.waitFor();
      assert.equal(
        await group.locator('[data-slot="list-row"]').count(),
        before.instances.length,
      );
      assert.equal(
        await group.evaluate((el) => getComputedStyle(el).borderTopWidth),
        "1px",
      );
      const rows = group.locator('[data-slot="list-row"]');
      assert.equal(
        await rows
          .nth(1)
          .evaluate((el) => getComputedStyle(el, "::before").display),
        "block",
      );
      await page.screenshot({ path: `/tmp/loom-126-computer-${width}.png` });
      assert.deepEqual(errors, []);
      results.push({
        width,
        token,
        roleSaved: true,
        avatarSaved: true,
        instancesPreserved: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
