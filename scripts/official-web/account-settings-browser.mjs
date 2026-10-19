import assert from "node:assert/strict";
export async function verifyAccountSettings({ browser, origin, client }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage(),
        errors = [],
        calls = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=account");
      const name = page.getByTestId("account-profile-display-name-input");
      await name.waitFor({ timeout: 5000 });
      const profile = page.getByTestId("account-profile-card");
      assert.equal(await profile.getAttribute("data-slot"), "card");
      const uploadInput = profile.locator('input[type="file"]');
      await name.focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await uploadInput.evaluate((el) => document.activeElement === el),
        true,
      );
      const veil = profile.locator("[data-avatar-edit-veil]");
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("[data-avatar-edit-veil]"))
            .opacity === "1",
      );
      const avatar = profile.locator('[data-avatar-context="profile-tile"]');
      assert.equal(Math.round((await avatar.boundingBox()).width), 51);
      assert.equal(Math.round((await veil.boundingBox()).width), 51);
      const chooser = page.waitForEvent("filechooser");
      await veil.click();
      await chooser;

      assert.equal(
        await page
          .getByTestId("account-profile-username-input")
          .getAttribute("readonly"),
        "",
      );
      await page.route("**/v3/client/principals/update", async (route) => {
        calls.push(route.request().postDataJSON());
        if (calls.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await name.fill(`FIXTURE name ${width}`);
      if (width === 390)
        await page
          .getByRole("button", { name: "设置列表", exact: true })
          .click();
      else
        await page
          .getByTestId("settings-sidebar-list")
          .getByRole("button", { name: "外观", exact: true })
          .click();
      const confirm = page.getByRole("alertdialog");
      await confirm.waitFor();
      await confirm
        .getByRole("button", { name: "继续编辑", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      assert.equal(await name.inputValue(), `FIXTURE name ${width}`);

      await page.getByRole("button", { name: "保存资料", exact: true }).click();
      await page
        .getByRole("button", { name: "读取当前资料", exact: true })
        .waitFor();
      assert.equal(await name.isDisabled(), true);
      await page
        .getByRole("button", { name: "读取当前资料", exact: true })
        .click();
      await page
        .getByText("已读取当前资料；未重复提交。", { exact: true })
        .waitFor();
      assert.equal(calls.length, 1);
      assert.equal(await name.inputValue(), `FIXTURE name ${width}`);
      const before = (await client.request("principal.me", {})).principal;
      await client.request("principal.update", {
        displayName: `FIXTURE external ${width}`,
        avatarKey: before.avatarKey ?? null,
      });
      await name.fill(`FIXTURE stale ${width}`);
      await page.getByRole("button", { name: "保存资料", exact: true }).click();
      await page
        .getByText("资料未保存，请读取当前资料后再修改。", { exact: true })
        .waitFor();
      assert.equal(
        (await client.request("principal.me", {})).principal.displayName,
        `FIXTURE external ${width}`,
      );
      await page
        .getByRole("button", { name: "读取当前资料", exact: true })
        .click();
      await page
        .getByText("已读取当前资料；未重复提交。", { exact: true })
        .waitFor();
      await name.fill(`FIXTURE unsaved ${width}`);
      const uploaded = page.waitForResponse(
        (r) =>
          r.url().endsWith("/v3/client/principals/update") &&
          r.status() === 200,
      );
      await page.locator('input[type="file"]').setInputFiles({
        name: "fixture.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await uploaded;
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="account-profile-card"] img')
            ?.complete === true,
      );
      const after = (await client.request("principal.me", {})).principal;
      assert.ok(after.avatarKey?.startsWith("upload_png_"));
      assert.equal(
        after.displayName,
        `FIXTURE external ${width}`,
        "Avatar upload does not save name draft",
      );
      assert.equal(await name.inputValue(), `FIXTURE unsaved ${width}`);
      await page.reload();
      await name.waitFor();
      assert.equal(await name.inputValue(), `FIXTURE external ${width}`);
      assert.equal(
        await page.locator('[data-testid="account-profile-card"] img').count(),
        1,
      );
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({
        width,
        unknownReadOnlyRecovery: true,
        staleRejected: true,
        avatar: true,
        unsavedNamePreserved: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
