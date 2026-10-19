import assert from "node:assert/strict";
async function verifyNativeSearchField(page) {
  const input = page.getByRole("textbox", { name: "搜索内容" });
  await input.waitFor();
  const group = input.locator('xpath=ancestor::*[@data-slot="input-group"]');
  assert.equal(
    await group.locator('[data-align="inline-start"] svg').count(),
    1,
  );
  await input.fill("before");
  await input.dispatchEvent("compositionstart");
  await input.fill("中文");
  assert.equal(new URL(page.url()).searchParams.get("q"), "before");
  await input.dispatchEvent("keydown", { key: "Escape", isComposing: true });
  assert.equal(await input.isVisible(), true);
  await input.dispatchEvent("compositionend", { data: "中文" });
  assert.equal(new URL(page.url()).searchParams.get("q"), "中文");
  const clear = group.getByRole("button");
  assert.equal(await clear.locator('svg[width="18"]').count(), 1);
  assert.equal(
    await clear.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
    true,
  );
  await clear.click();
  assert.equal(await input.inputValue(), "");
  assert.equal(new URL(page.url()).searchParams.get("q"), null);
}
export async function verifyTopbar({ browser, origin, channels }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/?room=" + channels[0].roomId);
    await page
      .getByTestId("loom-bootstrap-loading")
      .waitFor({ state: "hidden" });
    if (width === 1440) {
      await page.getByTestId("app-top-bar").waitFor({ timeout: 2000 });
      assert.equal(
        (await page.getByTestId("app-top-bar").boundingBox()).height,
        48,
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("button", { name: "搜索", exact: true })
          .count(),
        0,
      );
      const before = page.url();
      const composer = page.getByTestId("composer-textarea");
      await composer.fill("未发送草稿");
      await page.getByTestId("app-top-bar-search").click();
      await page.getByTestId("desktop-search-overlay").waitFor();
      await verifyNativeSearchField(page);
      await page.getByRole("textbox", { name: "搜索内容" }).fill("fixture");
      assert.equal(new URL(page.url()).searchParams.get("view"), "search");
      await page.keyboard.press("Escape");
      await page
        .getByTestId("desktop-search-overlay")
        .waitFor({ state: "hidden" });
      assert.equal(page.url(), before);
      assert.equal(await composer.inputValue(), "未发送草稿");
      await page.getByTestId("app-top-bar-search").click();
      await page.getByRole("textbox", { name: "搜索内容" }).fill("fixture");
      await page.getByTestId("search-view-all-results").click();
      assert.equal(
        new URL(page.url()).searchParams.get("presentation"),
        "page",
      );
      await page
        .getByTestId("desktop-search-overlay")
        .waitFor({ state: "hidden" });
      await page.reload();
      await page.getByRole("textbox", { name: "搜索内容" }).waitFor();
      await page.getByTestId("app-top-bar-search").click();
      await page.getByTestId("desktop-search-overlay").waitFor();
      await page.mouse.click(10, 500);
      await page
        .getByTestId("desktop-search-overlay")
        .waitFor({ state: "hidden" });
      await page.goto(before);
      await page.getByTestId("app-top-bar-search").waitFor();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByTestId("desktop-search-overlay").waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByTestId("desktop-search-overlay")
        .waitFor({ state: "hidden" });
      await page.getByTestId("app-top-bar-search").click();
      const overlay = page.getByTestId("desktop-search-overlay");
      const input = overlay.getByRole("textbox", { name: "搜索内容" });
      await input.fill("FIXTURE history");
      await overlay.locator("[data-result-id]").first().waitFor();
      assert.equal(
        await overlay.locator("[data-result-id]").count(),
        5,
        "Native overlay previews five messages; pagination belongs to the full page",
      );
      assert.equal(
        await overlay
          .getByRole("button", { name: "加载更多", exact: true })
          .count(),
        0,
      );
      await input.press("ArrowUp");
      assert.equal(
        await overlay
          .getByTestId("search-view-all-results")
          .getAttribute("data-selected"),
        "true",
        "Up at the first native rail row must stay there",
      );
      const expected = await overlay
        .locator("[data-result-id]")
        .first()
        .getAttribute("data-result-id");
      await input.press("ArrowDown");
      await input.press("Enter");
      await overlay.waitFor({ state: "hidden" });
      await page
        .locator(
          `[data-timeline-message-id="${expected}"] [data-highlighted="true"]`,
        )
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get("message"), expected);
      await page.getByTestId("app-top-bar-search").click();
      await input.fill("FIXTURE history");
      await overlay.getByLabel("打开频道筛选", { exact: true }).click();
      await page.getByRole("option").first().waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await overlay.count(), 1);
      await input.focus();
      await input.dispatchEvent("keydown", {
        key: "Escape",
        isComposing: true,
      });
      assert.equal(await overlay.count(), 1);
      await page.screenshot({
        path: "/tmp/loom-topbar-overlay.png",
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await overlay.waitFor({ state: "hidden" });
      await page
        .getByRole("textbox", { name: "搜索内容" })
        .waitFor({ timeout: 5000 })
        .catch(async (e) => {
          console.log({
            url: page.url(),
            text: (await page.locator("body").innerText()).slice(0, 1500),
            errors,
          });
          await page.screenshot({
            path: "/tmp/loom-topbar-resize-failure.png",
          });
          throw e;
        });
      assert.equal(
        await page.getByRole("textbox", { name: "搜索内容" }).inputValue(),
        "FIXTURE history",
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByTestId("app-top-bar").waitFor();
    } else {
      assert.equal(await page.getByTestId("app-top-bar").count(), 0);
      await page.goto(origin + "/?view=search");
      await page.getByRole("textbox", { name: "搜索内容" }).waitFor();
      await verifyNativeSearchField(page);
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `/tmp/loom-topbar-${width}.png`,
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    results.push({ width, passed: true });
    await context.close();
  }
  return results;
}

export async function openFullSearch(page) {
  if (page.viewportSize().width >= 768) {
    await page.getByTestId("app-top-bar-search").click();
    await page
      .getByTestId("desktop-search-overlay")
      .getByRole("textbox", { name: "搜索内容" })
      .fill("fixture");
    await page.getByTestId("search-view-all-results").click();
    await page
      .getByTestId("desktop-search-overlay")
      .waitFor({ state: "hidden" });
  } else await page.getByTestId("mobile-home-search-entry").click();
  await page.getByLabel("搜索内容", { exact: true }).waitFor();
  await page.getByLabel("搜索内容", { exact: true }).fill("");
}
