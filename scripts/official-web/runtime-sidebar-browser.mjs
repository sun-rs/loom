// Disposable real Core + fake native catalogs; no paid execution/production writes.
import assert from "node:assert/strict";
import { chooseOption } from "./select-browser.mjs";
import { verifyRoleSidebarAlignment } from "./role-sidebar-alignment-browser.mjs";
export async function verifyRuntimeSidebar({
  browser,
  origin,
  client,
  workspace,
  head,
  role,
}) {
  const { role: retired } = await client.request("role.create", {
    controlRoomId: workspace.controlRoomId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "retired-role",
    configuration: {
      ...role.configuration,
      displayName: "FixtureRetired",
      handle: "FixtureRetired",
    },
  });
  await client.request("role.delete", {
    roleId: retired.roleId,
    expectedRoleRevisionId: retired.roleRevisionId,
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "retire-role",
  });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        isMobile: width === 390,
        hasTouch: width === 390,
        locale: "zh-CN",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(8000);
    try {
      await page.goto(origin + "/?view=agents");
      const row = page.locator(`[data-role-id="${role.roleId}"]`),
        removed = page.locator(`[data-role-id="${retired.roleId}"]`);
      await row.waitFor();
      assert.equal(await removed.isVisible(), false);
      await page.getByTestId("role-section-toggle").click();
      assert.equal(await row.isVisible(), false);
      await page.getByTestId("deleted-role-section-toggle").click();
      await removed.waitFor();
      await page.reload();
      await removed.waitFor();
      assert.equal(
        await row.isVisible(),
        false,
        "both section states survive reload",
      );
      await page.getByTestId("deleted-role-section-toggle").click();
      assert.equal(await removed.isVisible(), false);
      await page.getByTestId("role-section-toggle").focus();
      await page.keyboard.press("Enter");
      await row.waitFor();
      const controls = await Promise.all(
        ["刷新角色", "新建角色"].map((name) =>
          page.getByRole("button", { name, exact: true }).evaluate((el) => ({
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            icon: el.querySelector("svg").getBoundingClientRect().width,
          })),
        ),
      );
      assert.equal(controls[0].width, controls[1].width);
      assert.equal(controls[0].height, controls[1].height);
      assert.equal(controls[0].icon, 14);
      assert.equal(controls[1].icon, 16);
      await page.screenshot({ path: `/tmp/loom-runtime-sidebar-${width}.png` });
      await row.click();
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      const dialog = page.getByTestId("agent-runtime-config-dialog");
      await chooseOption(page, dialog, "运行时", "Antigravity");
      await dialog.getByRole("combobox", { name: /^模型/ }).click();
      const labels = await page
        .getByRole("listbox")
        .getByRole("option")
        .allTextContents();
      assert.deepEqual(labels, ["Gemini 3.8 Flash"]);
      await page
        .getByRole("option", { name: "Gemini 3.8 Flash", exact: true })
        .click();
      await chooseOption(page, dialog, "推理强度", "low");
      const revised = page.waitForRequest((r) =>
        r.url().endsWith("/roles/revise"),
      );
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      const data = (await revised).postDataJSON();
      assert.deepEqual(data.configuration.modelIntent.exactBindingIds, [
        "local:agy-cli/v1:gemini-3.8-flash-low",
      ]);
      assert.equal(data.configuration.modelIntent.reasoning, "low");
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      await dialog.getByRole("combobox", { name: /^模型/ }).waitFor();
      assert.match(
        await dialog.getByRole("combobox", { name: /^模型/ }).inputValue(),
        /Gemini 3\.8 Flash/,
      );
      assert.match(
        await dialog.getByRole("combobox", { name: /^推理强度/ }).inputValue(),
        /low/,
      );
      await chooseOption(page, dialog, "推理强度", "medium");
      const changed = page.waitForRequest((r) =>
        r.url().endsWith("/roles/revise"),
      );
      await dialog
        .getByRole("button", { name: "保存运行时配置", exact: true })
        .click();
      assert.deepEqual(
        (await changed).postDataJSON().configuration.modelIntent
          .exactBindingIds,
        ["local:agy-cli/v1:gemini-3.8-flash-medium"],
      );
      await dialog.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      await chooseOption(page, dialog, "运行时", "Kimi Code");
      await dialog.getByRole("combobox", { name: /^模型/ }).click();
      await page
        .getByRole("option", { name: "K3.1 Pro", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `/tmp/loom-kimi-runtime-${width}.png` });
      results.push({
        width,
        foldBothSections: true,
        controls,
        agyModelEffortSplit: true,
        exactBindingRoundTrip: true,
        kimiProVisible: true,
      });
    } finally {
      await context.close();
    }
  }
  return {
    cases: results,
    geometry: await verifyRoleSidebarAlignment({
      browser,
      origin,
      role,
      expectedRuntime: "Agy",
    }),
  };
}
