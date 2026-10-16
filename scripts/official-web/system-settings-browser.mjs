import assert from "node:assert/strict";
export async function verifySystemSettings({
  browser,
  origin,
  client,
  workspace,
}) {
  const results = [];
  const all = (
    await client.request("room.list", { workspaceId: workspace.workspaceId })
  ).rooms.find((r) => r.slug === "all");
  assert.ok(all);
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
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=settings&settings=administration");
      const box = page.getByRole("checkbox");
      await box.waitFor({ timeout: 5000 });
      assert.equal(await box.isChecked(), false);
      await page.route(
        "**/v3/client/workspaces/system-channel/update",
        async (route) => {
          calls.push(route.request().postDataJSON());
          if (calls.length === 1) {
            await route.fetch();
            await route.abort("failed");
          } else await route.continue();
        },
      );
      await box.click();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .waitFor();
      assert.equal(await box.isDisabled(), true);
      assert.equal(calls.length, 1);
      assert.equal(
        (
          await client.request("workspace.system-channel.read", {
            workspaceId: workspace.workspaceId,
          })
        ).hidden,
        true,
      );
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .click();
      await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
      assert.deepEqual(calls[0], calls[1]);
      assert.equal(
        (
          await client.request("room.list", {
            workspaceId: workspace.workspaceId,
          })
        ).rooms.some((r) => r.roomId === all.roomId),
        false,
      );
      await page.reload();
      await box.waitFor();
      assert.equal(await box.isChecked(), true);
      await box.click();
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await page.getByRole("button", { name: "已保存", exact: true }).waitFor();
      assert.equal(
        (
          await client.request("workspace.system-channel.read", {
            workspaceId: workspace.workspaceId,
          })
        ).hidden,
        false,
      );
      assert.equal(
        (
          await client.request("room.list", {
            workspaceId: workspace.workspaceId,
          })
        ).rooms.some((r) => r.roomId === all.roomId),
        true,
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
        unknownExactRetry: true,
        hiddenPersists: true,
        restoreSameRoom: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
