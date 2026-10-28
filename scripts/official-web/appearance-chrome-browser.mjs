import assert from "node:assert/strict";
export async function verifyAppearanceChrome({ browser, origin, channels }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(5000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=theme");
      const picker = page.getByTestId("appearance-theme-picker");
      await picker.waitFor();
      assert.equal(
        await picker.getByRole("radio").count(),
        3,
        "official preview cards use radio semantics",
      );
      for (const mode of ["light", "dark", "system"]) {
        const card = page.getByTestId("appearance-theme-" + mode);
        await card.locator('[data-slot="card"]').click();
        await page.waitForFunction(
          (m) =>
            document
              .querySelector(
                `[data-testid="appearance-theme-${m}"] [role="radio"]`,
              )
              ?.getAttribute("aria-checked") === "true",
          mode,
        );
        assert.equal(
          await card.locator("svg").count(),
          1,
          "selected card check",
        );
        assert.ok(
          (await card.locator('[aria-hidden="true"]').count()) > 0,
          "native preview",
        );
      }
      const light = page.getByTestId("appearance-theme-light");
      await light.getByRole("radio").focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      await page.reload();
      await page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
      if (width === 1440) {
        const card = page
          .getByTestId("appearance-theme-light")
          .locator('[data-slot="card"]');
        await page.mouse.move(0, 0);
        const before = await card.evaluate(
          (e) => getComputedStyle(e).backgroundImage,
        );
        await card.hover();
        await page.waitForTimeout(200);
        assert.notEqual(
          await card.evaluate((e) => getComputedStyle(e).backgroundImage),
          before,
          "native card hover overlay",
        );
      }
      await page.screenshot({
        path: `/tmp/loom-appearance-chrome-${width}.png`,
      });
      for (const [query, prefix] of [
        [
          `room=${channels[0].roomId}&chat=list`,
          "public-server-channel-sidebar",
        ],
        ["view=agents", "agent-sidebar"],
        ["view=settings", "settings-sidebar"],
      ]) {
        await page.goto(origin + "/?" + query);
        await page.getByTestId(prefix + "-root").waitFor();
        assert.equal(
          await page
            .getByTestId(prefix + "-header")
            .isVisible()
            .catch(() => false),
          width === 390,
          "only mobile list title",
        );
      }
      await page.goto(origin + "/?view=computers");
      await page.getByTestId("loom-computers-page").waitFor();
      if (width === 1440)
        assert.equal(
          await page.locator('[data-slot="sidebar-header"]').count(),
          0,
        );
      await page.goto(origin + "/?view=memory");
      await page.getByRole("heading", { name: "记忆", exact: true }).waitFor();
      assert.equal(await page.locator("svg.lucide-brain").count(), 0);
      if (width === 1440) {
        const trigger = page.getByTestId("desktop-workspace-trigger");
        await trigger.waitFor();
        assert.equal(await trigger.locator('[data-slot="avatar"]').count(), 1);
        const before = await trigger.evaluate(
          (e) => getComputedStyle(e).backgroundColor,
        );
        await trigger.hover();
        await page.waitForTimeout(200);
        assert.notEqual(
          await trigger.evaluate((e) => getComputedStyle(e).backgroundColor),
          before,
        );
      }
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({
        width,
        previewRadioChecks: true,
        sidebarHeaders: true,
        workspaceAvatarHover: width === 1440,
        memoryIcon: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
