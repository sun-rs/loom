import { SIDEBAR_PANEL_BOUNDS } from "../../frontends/raft/packages/web/src/lib/panelBounds.ts";
import assert from "node:assert/strict";
// Temporary Core only; navigation and unsaved drafts do not mutate settings.
export async function verifySettingsNavigation({ browser, origin }) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?view=settings`);
    const list = page.getByTestId("settings-sidebar-list");
    await list.waitFor({ timeout: 5000 });
    for (const label of ["个人", "工作空间", "资源"])
      await list.getByText(label, { exact: true }).waitFor();
    assert.equal(
      await list.getByRole("button", { name: "MCP 服务器" }).count(),
      0,
    );
    const desktop = viewport.width >= 768;
    const nav = page.getByRole("navigation", { name: "主导航" });
    if (!desktop) {
      assert.equal(
        await page.getByTestId("loom-settings-detail").isVisible(),
        false,
      );
      assert.equal(await nav.isVisible(), true);
    } else {
      await page
        .getByTestId("loom-settings-detail")
        .getByRole("heading", { name: "账户", exact: true })
        .waitFor({ timeout: 5000 });
      const sidebar = page.getByTestId("loom-settings-sidebar");
      const before = await sidebar.boundingBox();
      assert.equal(before.width, SIDEBAR_PANEL_BOUNDS.defaultWidth);
      const handle = await page
        .getByTestId("settings-sidebar-resize")
        .boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.width / 2 + 40,
        handle.y + handle.height / 2,
        { steps: 5 },
      );
      await page.mouse.up();
      assert.equal(
        (await sidebar.boundingBox()).width,
        Math.min(
          SIDEBAR_PANEL_BOUNDS.max,
          SIDEBAR_PANEL_BOUNDS.defaultWidth + 40,
        ),
      );
      for (const [delta, expected] of [
        [600, SIDEBAR_PANEL_BOUNDS.max],
        [-600, SIDEBAR_PANEL_BOUNDS.min],
      ]) {
        const current = await page
          .getByTestId("settings-sidebar-resize")
          .boundingBox();
        await page.mouse.move(
          current.x + current.width / 2,
          current.y + current.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          Math.max(1, current.x + delta),
          current.y + current.height / 2,
          { steps: 5 },
        );
        await page.mouse.up();
        assert.equal((await sidebar.boundingBox()).width, expected);
      }
    }
    await list.getByRole("button", { name: "管理", exact: true }).click();
    const input = page.getByLabel("本机同时运行上限", { exact: true });
    await input.waitFor();
    await input.fill("6");
    if (!desktop) {
      assert.equal(await nav.count(), 0);
      await page.getByRole("button", { name: "设置列表", exact: true }).click();
      await list.waitFor();
    }
    await list.getByRole("button", { name: "外观", exact: true }).click();
    await page
      .getByTestId("loom-settings-detail")
      .getByRole("heading", { name: "外观", exact: true })
      .waitFor();
    await page.getByTestId("appearance-theme-picker").waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get("settings"),
      "appearance",
    );
    if (!desktop)
      await page.getByRole("button", { name: "设置列表", exact: true }).click();
    await list.getByRole("button", { name: "管理", exact: true }).click();
    assert.equal(await input.inputValue(), "6");
    if (!desktop)
      await page.getByRole("button", { name: "设置列表", exact: true }).click();
    await list.getByRole("button", { name: "通知", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page
      .getByTestId("loom-settings-detail")
      .getByRole("heading", { name: "通知", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByTestId("loom-settings-detail")
      .getByRole("heading", { name: "通知", exact: true })
      .waitFor();
    await page.goBack();
    if (desktop)
      await page
        .getByTestId("loom-settings-detail")
        .getByRole("heading", { name: "管理", exact: true })
        .waitFor();
    else await list.waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      nativeGroupedSidebar: true,
      resize: desktop,
      mobileMasterDetail: !desktop,
      placeholder: true,
      draftAcrossTabs: true,
      urlReloadAndBack: true,
      keyboardSelection: true,
    });
    await context.close();
  }
  return results;
}
