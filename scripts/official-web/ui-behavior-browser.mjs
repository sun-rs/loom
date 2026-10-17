// FIXTURE ONLY: existing Kernel fixture, fake discovery; no provider execution.
import assert from "node:assert/strict";
export async function verifyUiBehavior({
  browser,
  origin,
  client,
  workspace,
  role,
}) {
  await client.request("role.create", {
    controlRoomId: workspace.controlRoomId,
    basedOnRoomSeq: (
      await client.request("room.sync", {
        roomId: workspace.controlRoomId,
        consumerId: "browser-fixture",
      })
    ).latestRoomSeq,
    configuration: {
      ...role.configuration,
      displayName: "FixtureAlternate",
      handle: "fixture-alternate",
    },
    idempotencyKey: "ui-behavior-role",
  });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 560 : 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${origin}/?view=agents`);
    const rows = page.locator("[data-role-id]");
    await rows.first().waitFor();
    const id = await rows.first().getAttribute("data-role-id");
    await rows.first().click();
    assert.equal(
      new URL(page.url()).searchParams.get("role"),
      id,
      "role selection belongs to route",
    );
    if (width === 390)
      await page
        .locator('[data-slot="mobile-nav-root"]')
        .waitFor({ state: "hidden" });
    await page.reload();
    const name = page
      .getByTestId("loom-role-detail")
      .getByLabel("名称", { exact: true });
    await name.waitFor();
    const original = await name.inputValue();
    await name.fill(original + " draft");
    const save = page
      .getByTestId("loom-role-detail")
      .getByRole("button", { name: "保存角色", exact: true });
    await save.scrollIntoViewIfNeeded();
    assert.equal(await save.isEnabled(), true);
    assert.ok(
      await save.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
      "enabled save is not covered by mobile navigation",
    );
    if (width === 390)
      await page.getByRole("button", { name: "角色列表", exact: true }).click();
    else await rows.nth(1).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.waitFor();
    await confirm
      .getByRole("button", { name: "继续编辑", exact: true })
      .click();
    assert.equal(await name.inputValue(), original + " draft");
    if (width === 390)
      await page.getByRole("button", { name: "角色列表", exact: true }).click();
    else await rows.nth(1).click();
    await confirm
      .getByRole("button", { name: "放弃修改", exact: true })
      .click();
    if (width === 390) {
      await page.locator('[data-slot="mobile-nav-root"]').waitFor();
      await rows.first().click();
      await page.goBack();
      await rows.first().waitFor();
    } else {
      assert.notEqual(await name.inputValue(), original + " draft");
    }
    await page.goto(`${origin}/?view=channels`);
    await page.route("**/v3/client/sidebar/get", (r) => r.abort());
    await page.reload();
    await page
      .getByText("频道列表设置读取失败，请重试。", { exact: true })
      .waitFor();
    await page.unroute("**/v3/client/sidebar/get");
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await page
      .getByText("频道列表设置读取失败，请重试。", { exact: true })
      .waitFor({ state: "hidden" });
    results.push({
      width,
      route: true,
      draftConfirmation: true,
      readRecovery: true,
    });
    await context.close();
  }
  return results;
}
