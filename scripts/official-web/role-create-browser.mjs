// FIXTURE ONLY: isolated Core and fake providers. No product state or paid CLI.
import assert from "node:assert/strict";
import { chooseOption } from "./select-browser.mjs";
export async function verifyRoleCreation({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 844 },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(7000);
    const writes = [];
    page.on("request", (r) => {
      if (/\/(create|instantiate)$/.test(new URL(r.url()).pathname))
        writes.push({
          path: new URL(r.url()).pathname,
          body: r.postDataJSON(),
        });
    });
    await page.goto(`${origin}/?view=computers`);
    if (width < 768) await page.getByTestId("computer-mobile-row").click();
    await page
      .getByTestId("computer-instances")
      .getByRole("button", { name: "新建角色", exact: true })
      .click();
    const dialog = page.getByTestId("loom-create-role");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "随机名称" }).click();
    assert.match(
      await dialog.getByRole("textbox", { name: /^名称/ }).inputValue(),
      /^[a-z]+-[a-z]+$/,
    );
    await dialog
      .getByRole("textbox", { name: /^名称/ })
      .fill(`CreationFixture${width}`);
    await dialog
      .getByLabel("角色 Prompt", { exact: true })
      .fill("FIXTURE ONLY");
    await chooseOption(page, dialog, "运行时", 0);
    await chooseOption(page, dialog, "模型", 0);
    await dialog.getByRole("button", { name: "高级", exact: true }).click();
    await dialog.getByRole("button", { name: /添加变量/ }).click();
    await dialog
      .getByRole("textbox", { name: "环境变量名", exact: true })
      .fill("EXAMPLE_ROLE_VALUE");
    await dialog
      .getByRole("textbox", { name: /EXAMPLE_ROLE_VALUE/ })
      .fill("fixture-only");
    assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
    const save = dialog.getByRole("button", { name: "保存角色", exact: true });
    await save.click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(
      writes.find((w) => w.path.endsWith("/create")).body.configuration
        .environment,
      { EXAMPLE_ROLE_VALUE: "fixture-only" },
    );
    assert.equal(
      writes.filter((w) => w.path.endsWith("/instantiate")).length,
      0,
    );
    assert.equal(writes.filter((w) => w.path.endsWith("/create")).length, 1);
    await page.goto(`${origin}/?view=agents`);
    await page.getByRole("button", { name: "新建角色", exact: true }).click();
    await dialog.waitFor();
    await dialog
      .getByRole("textbox", { name: /^名称/ })
      .fill(`CreationChannelFixture${width}`);
    await dialog
      .getByLabel("角色 Prompt", { exact: true })
      .fill("FIXTURE ONLY");
    await chooseOption(page, dialog, "运行时", 0);
    await chooseOption(page, dialog, "模型", 0);
    await dialog.getByRole("checkbox").check();
    assert.equal(await save.isDisabled(), true);
    await chooseOption(page, dialog, "频道", 0);
    await save.click();
    await dialog.getByText(/已保存。尚未创建实例/).waitFor();
    assert.equal(
      writes.filter((w) => w.path.endsWith("/instantiate")).length,
      0,
    );
    let denied = true;
    await page.route("**/v3/client/roles/instantiate", (route) =>
      denied
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "fixture rejected" }),
          })
        : route.continue(),
    );
    await dialog.getByRole("button", { name: "确认添加实例" }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "添加实例被拒绝" })
      .waitFor();
    assert.equal(writes.filter((w) => w.path.endsWith("/create")).length, 2);
    denied = false;
    await dialog.getByRole("button", { name: "确认添加实例" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(writes.filter((w) => w.path.endsWith("/create")).length, 2);
    assert.equal(
      writes.filter((w) => w.path.endsWith("/instantiate")).length,
      2,
    );
    await page
      .locator("[data-role-id]")
      .filter({ hasText: `CreationChannelFixture${width}` })
      .click();
    await page
      .getByTestId("role-profile-actions")
      .getByRole("button", { name: "删除角色", exact: true })
      .click();
    const deletedResponse = page.waitForResponse(
      (r) => r.url().endsWith("/roles/delete") && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "确认删除角色", exact: true })
      .click();
    await deletedResponse;
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "确认删除角色", exact: true })
      .waitFor({ state: "hidden" });
    await page.goto(`${origin}/?view=agents`);
    const retiredToggle = page.getByRole("button", { name: /^已删除/ });
    try {
      await retiredToggle.waitFor();
    } catch (error) {
      console.error((await page.locator("body").innerText()).slice(0, 2500));
      throw error;
    }
    assert.equal(await retiredToggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page
        .locator("[data-role-id]")
        .filter({ hasText: `CreationChannelFixture${width}` })
        .count(),
      0,
    );
    await retiredToggle.click();
    await page
      .locator("[data-role-id]")
      .filter({ hasText: `CreationChannelFixture${width}` })
      .click();
    await page
      .getByTestId("role-profile-instances")
      .getByText("实例 1", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "恢复角色", exact: true }).click();
    const restore = page.getByRole("dialog");
    await restore
      .getByRole("textbox", { name: "名称", exact: true })
      .fill(`RestoredFixture${width}`);
    await restore
      .getByRole("button", { name: "确认恢复", exact: true })
      .click();
    await restore.waitFor({ state: "hidden" });
    await page
      .getByTestId("loom-role-profile")
      .getByText(`RestoredFixture${width}`, { exact: true })
      .first()
      .waitFor();
    await page
      .getByTestId("role-profile-instances")
      .getByText("实例 1", { exact: true })
      .waitFor();
    results.push({
      width,
      deletedSectionAndRestore: true,
      sharedDialog: true,
      randomName: true,
      defaultSaveOnly: true,
      separateChannelCreation: true,
      failedAddRetainsRole: true,
    });
    await context.close();
  }
  return results;
}
