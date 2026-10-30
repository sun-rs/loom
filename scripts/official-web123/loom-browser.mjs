import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyNativeLoom({
  browser,
  origin,
  workspace,
  role,
  channels,
  client,
  instances,
  head,
}) {
  const out = process.env.LOOM_WEB123_EVIDENCE ?? "/tmp/loom-web123-loom";
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        serviceWorkers: "allow",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [],
      consoleErrors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error") consoleErrors.push(e.text());
    });
    await context.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) {
        external.push(u.href);
        return route.abort();
      }
      return route.continue();
    });
    try {
      await page.goto(origin + "/s/" + workspace.slug + "/");
      await page.getByText(channels[0].name, { exact: true }).first().waitFor();
      await page.getByText(channels[0].name, { exact: true }).first().click();
      await page.getByText("FIXTURE history 55", { exact: true }).waitFor();
      await page.screenshot({ path: out + "/channel-" + width + ".png" });
      const scroll = page.getByTestId("message-scroller");
      await scroll.evaluate((el) => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
      });
      await page.getByText("FIXTURE history 1", { exact: true }).waitFor();
      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event("scroll"));
      });
      const draft = page.getByTestId("composer-textarea");
      await draft.fill("FIXTURE native123 send " + width);
      await draft.press("Enter");
      await page
        .getByText("FIXTURE native123 send " + width, { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid=\"composer-textarea\"]')
            ?.value === "",
      );
      const deadline = Date.now() + 12000;
      while (
        !(
          await client.request("message.list", {
            roomId: channels[0].roomId,
            limit: 100,
          })
        ).messages.some((m) => m.body === "FIXTURE native123 send " + width)
      ) {
        assert.ok(
          Date.now() < deadline,
          "native send did not commit to the real Kernel ledger",
        );
        await page.waitForTimeout(50);
      }

      await page.goto(
        origin + "/s/" + workspace.slug + "/agent/" + role.roleId,
      );
      await page.getByTestId("agent-change-avatar").waitFor();
      await page.screenshot({ path: out + "/role-" + width + ".png" });
      await page.getByRole("button", { name: "编辑描述", exact: true }).click();
      const dialog = page.getByTestId("agent-profile-edit-dialog");
      await dialog.locator("textarea").fill("FIXTURE remarks " + width);
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      const changed = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).roles.find((r) => r.roleId === role.roleId);
      assert.equal(
        changed.configuration.description,
        "FIXTURE remarks " + width,
      );
      assert.equal(
        changed.configuration.instructions,
        role.configuration.instructions,
      );

      await page.getByTestId("agent-change-avatar").click();
      const avatar = page.getByTestId("agent-profile-edit-dialog");
      await avatar
        .getByRole("button", {
          name: width === 1440 ? "cat" : "ghost",
          exact: true,
        })
        .click();
      await avatar.getByTestId("agent-profile-edit-save").click();
      await avatar.waitFor({ state: "hidden" });
      const roleAvatar = await page
        .getByTestId("agent-change-avatar")
        .locator("img")
        .getAttribute("src");
      await page.goto(
        origin + "/s/" + workspace.slug + "/agent/" + instances[0].instanceId,
      );
      await page.getByTestId("agent-change-avatar").waitFor();
      assert.equal(
        await page
          .getByTestId("agent-change-avatar")
          .locator("img")
          .getAttribute("src"),
        roleAvatar,
        "native instance view must use current Role avatar",
      );
      const frozen = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).instances.find((i) => i.instanceId === instances[0].instanceId);
      assert.equal(
        frozen.roleRevisionId,
        instances[0].roleRevisionId,
        "avatar presentation must not adopt a new execution revision",
      );
      await page.screenshot({
        path: out + "/instance-avatar-" + width + ".png",
      });
      await page.goto(origin + "/s/" + workspace.slug + "/");
      await page
        .getByRole("button", { name: "创建频道", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      const create = page.locator('[data-slot="dialog-card"]');
      await create.getByPlaceholder("例如 ai-research").fill("native-" + width);
      await create
        .getByRole("button", { name: "FixtureTom", exact: true })
        .click();
      await create
        .getByRole("button", { name: "创建频道", exact: true })
        .click();
      await create.waitFor({ state: "hidden" });
      const created = (
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms.filter((r) => r.name === "native-" + width);
      assert.equal(created.length, 1);
      const createdMembers = (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).instances.filter((i) => i.channelId === created[0].roomId);
      assert.equal(createdMembers.length, 1);
      assert.equal(createdMembers[0].roleId, role.roleId);
      await page.getByTestId("composer-textarea").waitFor();
      await page.waitForLoadState("networkidle");
      await page.goto(origin + "/s/" + workspace.slug + "/members");
      await page
        .getByRole("button", { name: "添加 Agent", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page
        .getByRole("menuitem", { name: "创建 Agent", exact: true })
        .click();
      await page.locator("#create-agent-name").fill("NativeRole" + width);
      await page.getByTestId("runtime-model-combobox").click();
      await page
        .getByRole("option", { name: "gpt-members-fixture", exact: true })
        .click();
      const roleCreate = page.locator('[data-slot="dialog-card"]');
      await roleCreate.locator('button[type="submit"]').click();
      await roleCreate.waitFor({ state: "hidden" });
      const roleAfter = await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        }),
        newRole = roleAfter.roles.find(
          (r) => r.configuration.displayName === "NativeRole" + width,
        );
      assert.ok(newRole);
      assert.equal(newRole.configuration.instructions, "");
      assert.equal(
        roleAfter.instances.some((i) => i.roleId === newRole.roleId),
        false,
        "configuration creation must not start an instance",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      results.push({
        width,
        channelRead: true,
        boundedOlderPage: true,
        nativeComposerSend: true,
        roleRead: true,
        roleEditPreservesPrompt: true,
        avatarFollowsStableRoleId: true,
        nativeChannelCreateWithInstance: true,
        nativeRoleCreateWithoutInstance: true,
        executionRevisionUnchanged: true,
        errors,
        consoleErrors,
        blockedExternal: external,
      });
    } catch (error) {
      await page.screenshot({ path: out + "/failure-" + width + ".png" });
      writeFileSync(
        out + "/failure.json",
        JSON.stringify(
          {
            width,
            url: page.url(),
            error: error.message,
            errors,
            consoleErrors,
            external,
            body: await page.locator("body").innerText(),
          },
          null,
          2,
        ) + "\n",
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  writeFileSync(
    out + "/report.json",
    JSON.stringify(
      { isolatedCore: true, paidProviders: 0, readOnlyIntake: false, results },
      null,
      2,
    ) + "\n",
  );
  return results;
}
