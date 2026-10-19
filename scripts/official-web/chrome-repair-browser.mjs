import assert from "node:assert/strict";
export async function verifyChromeRepair({
  browser,
  origin,
  channels,
  client,
}) {
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
    await page.goto(`${origin}/?room=${channels[2].roomId}`);
    const settings = page.getByTestId("loom-channel-control-trigger");
    await settings.waitFor();
    const chatIcon = page.locator(
      '.loom-chat-header [data-slot="panel-header-icon"]',
    );
    assert.equal(await chatIcon.count(), 1);
    assert.equal(
      await chatIcon.evaluate((el) => el.classList.contains("bg-fill-muted")),
      false,
    );

    assert.equal(
      await page
        .getByRole("button", { name: "频道成员与状态", exact: true })
        .count(),
      0,
    );
    await settings.click();
    const sheet = page.getByTestId("loom-channel-control-sheet");
    await sheet.waitFor();
    await sheet.getByTestId("loom-channel-members").waitFor();
    await page.waitForFunction(() => {
      const rect = document
        .querySelector('[data-testid="loom-channel-control-sheet"]')
        ?.getBoundingClientRect();
      return rect && Math.abs(rect.right - innerWidth) < 2;
    });
    await sheet.getByRole("button", { name: "取消", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "搜索聊天", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("view") === "search");
    if (viewport.width >= 768)
      await page.getByTestId("desktop-search-overlay").waitFor();
    await page.goto(`${origin}/?view=computers`);
    if (viewport.width < 768)
      await page.getByTestId("computer-mobile-row").click();
    await page.getByTestId("computer-detail").waitFor();
    const computerIcon = page
      .locator('[data-slot="panel-header-icon"]')
      .filter({ has: page.locator("svg.lucide-monitor") });
    assert.equal(await computerIcon.count(), 1);
    assert.equal(
      await computerIcon.evaluate((el) =>
        el.classList.contains("bg-fill-muted"),
      ),
      true,
    );

    await page.getByTestId("machine-detected-runtimes").waitFor();
    const inventory = await client.request("host.runtime.list", {});
    assert.ok(inventory.computer.profileRevision !== undefined);
    const original = inventory.computer.displayName;
    await page
      .getByRole("button", { name: "编辑计算机名称", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "计算机名称", exact: true })
      .fill(`FIXTURE edited ${viewport.width}`);
    let request;
    await page.route("**/v3/client/computers/profile/update", async (route) => {
      request = route.request().postDataJSON();
      await route.fetch();
      await route.abort();
    });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "核实操作结果" }).waitFor();
    await page.unroute("**/v3/client/computers/profile/update");
    const replay = page.waitForRequest((r) =>
      r.url().endsWith("/computers/profile/update"),
    );
    await page.getByRole("button", { name: "核实操作结果" }).click();
    assert.deepEqual((await replay).postDataJSON(), request);
    await page
      .getByRole("button", { name: "编辑计算机名称", exact: true })
      .waitFor();
    assert.equal(
      (await client.request("host.runtime.list", {})).computer.displayName,
      `FIXTURE edited ${viewport.width}`,
    );
    await page
      .getByRole("button", { name: "编辑计算机描述", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "计算机描述", exact: true })
      .fill("FIXTURE description");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .getByRole("button", { name: "编辑计算机描述", exact: true })
      .waitFor();
    assert.equal(
      (await client.request("host.runtime.list", {})).computer.description,
      "FIXTURE description",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      drawerSearch: true,
      defaultComputer: viewport.width >= 768,
      profileEditAndExactReplay: true,
      cliInventory: true,
    });
    await context.close();
  }
  return { fixture: true, results };
}
