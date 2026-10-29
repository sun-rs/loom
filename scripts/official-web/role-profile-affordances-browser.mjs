// Focused isolated Core, no provider runs or production data.
import assert from "node:assert/strict";
export async function verifyRoleProfileAffordances({
  browser,
  origin,
  client,
  workspace,
  role,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        isMobile: width === 390,
        hasTouch: width === 390,
      }),
      page = await context.newPage();
    const writes = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/roles/revise")) writes.push(r.postDataJSON());
    });
    try {
      await page.goto(origin + "/?view=agents&role=" + role.roleId);
      const profile = page.getByTestId("loom-role-profile");
      await profile.waitFor();
      for (const label of ["描述", "提示词"]) {
        const pencil = profile.getByRole("button", {
          name: "编辑" + label,
          exact: true,
        });
        await pencil.click();
        const dialog = page.getByTestId("role-description-dialog");
        await dialog.waitFor();
        await page.waitForFunction(
          (expected) =>
            document.activeElement?.getAttribute("aria-label") === expected,
          label,
        );
        assert.equal(
          await dialog
            .getByLabel(label, { exact: true })
            .evaluate((el) => el === document.activeElement),
          true,
        );
        await dialog.getByRole("button", { name: "关闭", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction(
          (expected) =>
            document.activeElement?.getAttribute("aria-label") === expected,
          "编辑" + label,
        );
      }
      await profile
        .getByRole("button", { name: "编辑提示词", exact: true })
        .click();
      const editor = page.getByTestId("role-description-dialog");
      await editor
        .getByLabel("描述", { exact: true })
        .fill("FIXTURE remark " + width);
      await editor
        .getByLabel("提示词", { exact: true })
        .fill("FIXTURE prompt " + width);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      assert.equal(writes.length, 1, "two fields still commit one revision");
      const saved = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).roles.find((r) => r.roleId === role.roleId);
      assert.equal(saved.configuration.instructions, "FIXTURE prompt " + width);
      assert.equal(saved.configuration.description, "FIXTURE remark " + width);
      const trigger = profile.getByTestId("role-runtime-info-trigger");
      await trigger.waitFor();
      assert.equal(
        await trigger.getByLabel("CLI 已检测到", { exact: true }).count(),
        1,
      );
      if (width === 1440) {
        await trigger.hover();
      } else {
        await trigger.click();
      }
      const info = page.getByRole("dialog", {
        name: "Codex CLI 运行时信息",
        exact: true,
      });
      await info.waitFor();
      const inventory = await client.request("host.runtime.list", {});
      const runtime = inventory.runtimes.find(
        (r) => r.runtimeOfferId === saved.configuration.runtimeOfferId,
      );
      assert.equal(
        await info.getByTestId("runtime-info-version").textContent(),
        runtime.version ? `版本 ${runtime.version}` : "版本暂不可用",
      );
      assert.ok((await info.innerText()).includes("未提供账户额度"));
      await page.screenshot({ path: `/tmp/loom-runtime-info-${width}.png` });
      if (width === 1440) {
        await info.hover();
        assert.equal(await info.isVisible(), true);
        await page.mouse.move(10, 10);
        await info.waitFor({ state: "hidden" });
        await trigger.click();
        await info.waitFor();
        await page.keyboard.press("Escape");
        await info.waitFor({ state: "hidden" });
      } else {
        await info.getByRole("button", { name: "关闭运行时信息" }).click();
        await info.waitFor({ state: "hidden" });
      }
      // Missing/unavailable native metadata must not become a green account-health claim.
      await page.route("**/v1/local/runtimes/list", async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        body.runtimes = body.runtimes.map((runtime) => ({
          ...runtime,
          available: false,
        }));
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await profile
        .getByTestId("role-runtime-info-trigger")
        .getByLabel("CLI 未检测到", { exact: true })
        .waitFor();
      assert.equal(
        await profile
          .getByTestId("role-runtime-info-trigger")
          .getByLabel("CLI 未检测到", { exact: true })
          .getAttribute("data-variant"),
        "default",
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        bothPencilsFocusCorrectInput: true,
        returnFocus: true,
        oneRevision: true,
        runtimeFacts: true,
        quotaUnknownExplicit: true,
        hoverOrTouch: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
