import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
export async function verifyNativeManagement({
  browser,
  origin,
  workspace,
  channels,
  client,
  role: template,
  head,
}) {
  const out =
    process.env.LOOM_WEB123_MANAGEMENT_EVIDENCE ??
    "/tmp/loom-web123-management";
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const width of [1440, 390]) {
    const name = "ManageRole" + width,
      created = await client.request("role.create", {
        controlRoomId: workspace.controlRoomId,
        configuration: {
          ...template.configuration,
          displayName: name,
          handle: name,
          instructions: "ORIGINAL PROMPT",
          description: "ORIGINAL REMARK",
        },
        basedOnRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: "management-role-" + width,
      }),
      role = created.role;
    const frozen = [];
    for (let i = 0; i < 2; i++)
      frozen.push(
        (
          await client.request("role.instantiate", {
            roleId: role.roleId,
            channelId: channels[2].roomId,
            basedOnRoomSeq: await head(channels[2].roomId),
            idempotencyKey: `management-instance-${width}-${i}`,
          })
        ).instance,
      );
    const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        locale: "zh-CN",
        serviceWorkers: "allow",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(14000);
    const errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/v3/client/") && r.method() !== "GET")
        writes.push({
          path: new URL(r.url()).pathname,
          input: r.postDataJSON(),
        });
    });
    const catalog = () =>
      client.request("role.list", { controlRoomId: workspace.controlRoomId });
    async function until(check, message) {
      const end = Date.now() + 14000;
      while (!(await check())) {
        assert.ok(Date.now() < end, message);
        await page.waitForTimeout(40);
      }
    }
    try {
      await page.goto(
        origin + "/s/" + workspace.slug + "/agent/" + role.roleId,
      );
      await page
        .getByRole("button", { name: "编辑提示词", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "编辑提示词", exact: true })
        .click();
      let editor = page.getByTestId("loom-role-editor");
      await editor.waitFor();
      await page.waitForFunction(
        () => document.activeElement?.id === "loom-role-prompt",
      );
      assert.equal(
        await editor.getByLabel("提示词", { exact: true }).inputValue(),
        "ORIGINAL PROMPT",
      );
      assert.equal(
        await editor
          .getByLabel("提示词", { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await editor.getByLabel("提示词", { exact: true }).fill("UPDATED PROMPT");
      await editor.getByLabel("描述", { exact: true }).fill("UPDATED REMARK");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      let saved = (await catalog()).roles.find((r) => r.roleId === role.roleId);
      assert.equal(saved.configuration.instructions, "UPDATED PROMPT");
      assert.equal(saved.configuration.description, "UPDATED REMARK");
      await page.getByRole("button", { name: "编辑描述", exact: true }).click();
      await editor.waitFor();
      await page
        .waitForFunction(
          () => document.activeElement?.id === "loom-role-description",
        )
        .catch(async (error) => {
          throw Error(
            error.message +
              " active=" +
              (await page.evaluate(() => document.activeElement?.outerHTML)),
          );
        });
      assert.equal(
        await editor
          .getByLabel("描述", { exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await editor.getByLabel("提示词", { exact: true }).fill("");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      saved = (await catalog()).roles.find((r) => r.roleId === role.roleId);
      assert.equal(saved.configuration.instructions, "");
      assert.ok(
        (await catalog()).instances
          .filter((i) => frozen.some((f) => f.instanceId === i.instanceId))
          .every((i) => i.roleRevisionId === role.roleRevisionId),
      );
      const list = page.getByTestId("loom-role-instances");
      assert.equal(await list.locator('[data-slot="list-row"]').count(), 2);
      await list.getByRole("button", { name: "实例", exact: true }).click();
      const create = page.getByTestId("loom-create-instance");
      await create
        .getByRole("button", { name: "添加实例", exact: true })
        .click();
      await create.waitFor({ state: "hidden" });
      await until(
        async () =>
          (await catalog()).instances.filter((i) => i.roleId === role.roleId)
            .length === 3,
        "native instance creation did not persist",
      );
      const members = (await catalog()).instances.filter(
        (i) => i.roleId === role.roleId,
      );
      assert.equal(
        members.find((i) => !frozen.some((f) => f.instanceId === i.instanceId))
          .roleRevisionId,
        saved.roleRevisionId,
      );
      await page
        .getByRole("button", { name: "停止所有实例", exact: true })
        .click();
      const confirm = page
        .locator('[data-slot="dialog-content"]')
        .filter({ visible: true });
      await confirm
        .getByRole("button", { name: "停止 Agent", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      await until(async () => {
        const agents = (
          await client.request("agent.list", {
            controlRoomId: workspace.controlRoomId,
          })
        ).agents;
        return members.every(
          (i) =>
            agents.find((a) => a.definition.agentId === i.agentId).definition
              .state === "disabled",
        );
      }, "Role stop did not disable the real instance IDs");
      await page
        .getByRole("button", { name: "启用所有实例", exact: true })
        .click();
      await until(async () => {
        const agents = (
          await client.request("agent.list", {
            controlRoomId: workspace.controlRoomId,
          })
        ).agents;
        return members.every(
          (i) =>
            agents.find((a) => a.definition.agentId === i.agentId).definition
              .state === "enabled",
        );
      }, "Role start did not enable instances");
      await page
        .getByRole("button", { name: "重启 / 重置", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      const restartBefore = writes.filter((w) =>
        w.path.endsWith("/agents/manage"),
      ).length;
      await confirm
        .getByRole("button", { name: "重新启动", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      assert.equal(
        writes.filter((w) => w.path.endsWith("/agents/manage")).length -
          restartBefore,
        6,
      );
      assert.equal(
        writes.some((w) => w.path.endsWith("/agents/execution/reset")),
        false,
      );
      await page
        .getByRole("button", { name: "重启 / 重置", exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await page.getByTestId("agent-reset-option-session").click();
      await confirm
        .getByRole("button", { name: "重置会话", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      assert.equal(
        writes.filter((w) => w.path.endsWith("/instances/session/reset"))
          .length,
        3,
      );
      await page.screenshot({ path: out + "/role-" + width + ".png" });
      await page.getByTestId("agent-archive-button").click();
      await confirm
        .getByRole("button", { name: "删除角色", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      await page.getByTestId("loom-role-restore").waitFor();
      let after = await catalog();
      assert.ok(after.deletedRoles.some((r) => r.roleId === role.roleId));
      assert.equal(
        after.instances.filter((i) => i.roleId === role.roleId).length,
        3,
      );
      await page.getByRole("button", { name: "恢复角色", exact: true }).click();
      await confirm.getByLabel("名称", { exact: true }).fill(name + "Restored");
      await confirm
        .getByRole("button", { name: "恢复角色", exact: true })
        .click();
      await confirm.waitFor({ state: "hidden" });
      after = await catalog();
      assert.equal(
        after.roles.find((r) => r.roleId === role.roleId).configuration
          .displayName,
        name + "Restored",
      );
      // Real native drawer preference and metadata updates, with SDK read-back.
      const preference = (
          await client.request("sidebar.get", {
            workspaceId: workspace.workspaceId,
          })
        ).preferences,
        key = "room:" + channels[0].roomId;
      await client.request("sidebar.patch", {
        workspaceId: workspace.workspaceId,
        expectedVersion: preference.version,
        idempotencyKey: "management-reset-preferences-" + width,
        patch: {
          mutedActivity: preference.mutedActivity.filter((k) => k !== key),
          expandedLongMessages: preference.expandedLongMessages.filter(
            (k) => k !== key,
          ),
        },
      });
      await page.goto(
        origin + "/s/" + workspace.slug + "/channel/" + channels[0].roomId,
      );
      await page.getByTestId("composer-textarea").waitFor();
      await page
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      await page.getByTestId("channel-overflow-mute-switch").click();
      await until(
        async () =>
          (
            await client.request("sidebar.get", {
              workspaceId: workspace.workspaceId,
            })
          ).preferences.mutedActivity.includes("room:" + channels[0].roomId),
        "native mute did not persist",
      );
      await page.getByTestId("channel-settings-collapse-switch").click();
      await until(
        async () =>
          (
            await client.request("sidebar.get", {
              workspaceId: workspace.workspaceId,
            })
          ).preferences.expandedLongMessages.includes(
            "room:" + channels[0].roomId,
          ),
        "native display preference did not persist",
      );
      await page
        .locator("#channel-settings-name")
        .fill("managed-channel-" + width);
      await page
        .locator("#channel-settings-description")
        .fill("Managed description " + width);
      await page
        .getByRole("button", { name: "保存", exact: true })
        .filter({ visible: true })
        .click();
      await until(
        async () =>
          (
            await client.request("room.list", {
              workspaceId: workspace.workspaceId,
            })
          ).rooms.some(
            (r) =>
              r.roomId === channels[0].roomId &&
              r.name === "managed-channel-" + width &&
              r.description === "Managed description " + width,
          ),
        "native channel metadata did not persist",
      );
      await page.screenshot({
        path: out + "/channel-settings-" + width + ".png",
      });
      assert.deepEqual(errors, []);
      results.push({
        width,
        rolePromptAndRemarks: true,
        emptyPrompt: true,
        fieldInitialFocus: true,
        frozenInstancesUnchanged: true,
        createInstance: true,
        roleBatchStopStart: true,
        explicitSessionReset: true,
        preservingSessionRestart: true,
        deleteRetainsInstances: true,
        restoreStableRoleId: true,
        muteAndCollapsePersistence: true,
        channelMetadataSave: true,
        errors,
      });
    } catch (error) {
      await page.screenshot({ path: out + "/failure-" + width + ".png" });
      writeFileSync(
        out + "/failure.json",
        JSON.stringify(
          {
            width,
            error: error.stack,
            body: await page.locator("body").innerText(),
            errors,
            writes,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  const result = { temporaryCore: true, paidCalls: 0, results };
  writeFileSync(out + "/report.json", JSON.stringify(result, null, 2) + "\n");
  return result;
}
