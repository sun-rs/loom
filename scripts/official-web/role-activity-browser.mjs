import assert from "node:assert/strict";
export async function verifyRoleActivity({ browser, origin, client, role }) {
  const catalog = await client.request("role.list", {
    controlRoomId: role.controlRoomId,
  });
  const agents = (
    await client.request("agent.list", { controlRoomId: role.controlRoomId })
  ).agents;
  const members = catalog.instances
    .filter((i) => i.roleId === role.roleId)
    .map((i) => ({
      ...i,
      agent: agents.find((a) => a.definition.agentId === i.agentId),
    }));
  assert.ok(members.length >= 2);
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width === 390,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    let inspectLong = false;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/v1/local/runtimes/list", async (route) => {
      const response = await route.fetch();
      const inventory = await response.json();
      for (const runtime of inventory.runtimes) {
        const first = runtime.modelBindingDescriptors[0];
        if (first)
          runtime.modelBindingDescriptors.push(
            {
              ...first,
              modelBindingId: first.modelBindingId + "-fixture-high",
              displayName: "FIXTURE high model",
              supportedReasoning: ["high"],
              reasoningOptions: [{ value: "high", label: "high" }],
              defaultReasoning: "high",
            },
            {
              ...first,
              modelBindingId: first.modelBindingId + "-fixture-none",
              displayName: "FIXTURE no effort model",
              supportedReasoning: [],
              reasoningOptions: [],
              defaultReasoning: undefined,
            },
          );
      }
      await route.fulfill({ json: inventory });
    });
    await page.route("**/v3/client/agents/trajectory/list", async (route) => {
      const input = route.request().postDataJSON();
      const member = members.find((m) => m.agentId === input.agentId);
      assert.ok(member);
      assert.equal(input.limit, 50);
      const record = {
        activityId:
          "fixture-" +
          member.instanceId +
          (input.beforeActivityId ? "-old" : ""),
        roomId: member.channelId,
        participantId: member.agent.definition.participantId,
        serverSequence: 1,
        producerSequence: 1,
        observedAt: "2026-10-21T00:00:00Z",
        recordedAt: "2026-10-21T00:00:00Z",
        runAttemptId: "fixture-run",
        runtimeRunId: "fixture-runtime",
        entry: {
          kind: "text",
          text: input.beforeActivityId
            ? "FIXTURE older detail"
            : inspectLong
              ? "FIXTURE long diagnostic ".repeat(40)
              : "FIXTURE activity detail",
        },
      };
      await route.fulfill({
        json: {
          activities: [
            record,
            {
              ...record,
              activityId: "secret",
              roomId: "other-room",
              entry: { kind: "text", text: "SECRET" },
            },
          ],
          ...(input.beforeActivityId ? {} : { nextCursor: "older" }),
        },
      });
    });
    try {
      await page.goto(`${origin}/?view=agents&role=${role.roleId}`);
      const tabs = page.getByRole("tablist", { name: "角色详情" });
      await tabs.getByRole("tab", { name: "动态", exact: true }).waitFor();
      assert.deepEqual(await tabs.getByRole("tab").allTextContents(), [
        "动态",
        "资料",
      ]);
      await page.getByTestId("loom-role-profile").waitFor();
      assert.equal(
        await tabs
          .getByRole("tab", { name: "资料", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await tabs.getByRole("tab", { name: "动态", exact: true }).click();
      // Re-selecting from the Role list uses the same official profile default.
      if (width < 768)
        await page
          .getByRole("button", { name: "角色列表", exact: true })
          .click();
      const roleRow = page.locator(`[data-role-id="${role.roleId}"]`);
      await roleRow.scrollIntoViewIfNeeded();
      await roleRow.click({ trial: true });
      const rowHit = await roleRow.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          top = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
        return { height: r.height, clickable: top === el || el.contains(top) };
      });
      assert.ok(rowHit.clickable);
      if (width < 768)
        assert.equal(rowHit.height, 34, "approved native-app compact Role row");
      await roleRow.click();
      await page.getByTestId("loom-role-profile").waitFor();
      assert.equal(
        await tabs
          .getByRole("tab", { name: "资料", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await tabs.getByRole("tab", { name: "动态", exact: true }).click();
      const activity = page.getByTestId("role-activity");
      await activity.getByTestId("role-activity-row").first().waitFor();
      assert.equal(
        await activity.getByTestId("role-activity-row").count(),
        members.length,
      );
      assert.equal(await activity.getByText("SECRET").count(), 0);
      const name =
        members[0].agent.currentRevision.displayName ?? members[0].agent.handle;
      await activity.getByRole("combobox", { name: "实例动态" }).click();
      await page.getByRole("option", { name, exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="role-activity-row"]')
            .length === 1,
      );
      await activity.getByRole("button", { name: "更早动态" }).click();
      await activity
        .getByText("FIXTURE older detail", { exact: true })
        .waitFor();
      await page.screenshot({ path: `/tmp/loom-role-activity-${width}.png` });
      await tabs.getByRole("tab", { name: "资料", exact: true }).click();
      await page.getByTestId("role-profile-instances").waitFor();
      assert.equal(
        await tabs.getByRole("tab", { name: "实例", exact: true }).count(),
        0,
      );
      const profile = page.getByTestId("loom-role-profile");
      assert.equal(
        await profile
          .getByRole("button", { name: "编辑推理强度", exact: true })
          .count(),
        0,
      );
      await profile
        .getByRole("button", { name: "编辑运行时配置", exact: true })
        .click();
      const runtimeDialog = page.getByTestId("agent-runtime-config-dialog");
      await runtimeDialog
        .getByRole("combobox", { name: "模型", exact: true })
        .waitFor();
      await page.screenshot({ path: `/tmp/loom-runtime-dialog-${width}.png` });
      await runtimeDialog
        .getByRole("combobox", { name: "推理强度", exact: true })
        .waitFor();
      await runtimeDialog
        .getByRole("combobox", { name: "模型", exact: true })
        .click();
      await page
        .getByRole("option", { name: "FIXTURE high model", exact: true })
        .click();
      assert.match(
        await runtimeDialog
          .getByRole("combobox", { name: "推理强度", exact: true })
          .innerText(),
        /high/,
      );
      await runtimeDialog
        .getByRole("combobox", { name: "模型", exact: true })
        .click();
      await page
        .getByRole("option", { name: "FIXTURE no effort model", exact: true })
        .click();
      assert.equal(
        await runtimeDialog
          .getByRole("combobox", { name: "推理强度", exact: true })
          .isDisabled(),
        true,
      );
      await runtimeDialog
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("button", { name: "放弃修改", exact: true }).click();
      await runtimeDialog.waitFor({ state: "hidden" });
      const actions = page.getByTestId("role-profile-actions");
      for (const label of [
        "添加实例到频道",
        "停止所有实例",
        "启用所有实例",
        "重启／重置所有实例",
        "删除角色",
      ]) {
        const button = actions.getByRole("button", {
          name: label,
          exact: true,
        });
        assert.equal(await button.locator("svg").count(), 1);
      }
      await actions
        .getByRole("button", { name: "停止所有实例", exact: true })
        .click();
      const confirm = page.locator(
        '[role="dialog"][data-slot="dialog-content"]',
      );
      await confirm
        .getByText(
          `本次操作 ${members.length} 个实例。遇到拒绝或结果未知即停止；已成功的操作不会回滚。`,
        )
        .waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).click();
      await actions
        .getByRole("button", { name: "重启／重置所有实例", exact: true })
        .click();
      await confirm
        .getByRole("combobox", { name: "重启配置", exact: true })
        .waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).click();
      await actions
        .getByRole("button", { name: "删除角色", exact: true })
        .click();
      await confirm
        .getByRole("button", { name: "确认删除角色", exact: true })
        .waitFor();
      await confirm.getByRole("button", { name: "取消", exact: true }).click();
      assert.equal(
        await page
          .getByTestId("role-profile-instances")
          .getByRole("button", { name: "添加实例到频道", exact: true })
          .count(),
        1,
      );
      if (width === 390) {
        for (const label of [
          "停止所有实例",
          "启用所有实例",
          "重启／重置所有实例",
        ]) {
          await actions
            .getByRole("button", { name: label, exact: true })
            .click();
          await confirm
            .getByRole("button", { name: label, exact: true })
            .click();
          await confirm
            .locator("li")
            .filter({ hasText: "已完成" })
            .nth(members.length - 1)
            .waitFor();
          assert.equal(
            await confirm.locator("li").filter({ hasText: "已完成" }).count(),
            members.length,
          );
          await confirm
            .getByRole("button", { name: "取消", exact: true })
            .click();
        }
        const after = (
          await client.request("agent.list", {
            controlRoomId: role.controlRoomId,
          })
        ).agents;
        for (const member of members)
          assert.equal(
            after.find((a) => a.definition.agentId === member.agentId)
              .definition.state,
            "enabled",
          );
      }
      inspectLong = true;
      await page
        .getByTestId("role-profile-instances")
        .getByRole("button")
        .filter({ has: page.getByText(name, { exact: true }) })
        .click();
      const inspector = page.getByTestId("profile-panel");
      const trajectory = inspector.getByTestId("loom-trajectory");
      await trajectory.getByTestId("loom-trajectory-row").waitFor();
      assert.equal(
        await trajectory.getByTestId("loom-trajectory-row").count(),
        1,
      );
      assert.equal(await trajectory.getByText("SECRET").count(), 0);
      const output = trajectory.getByRole("button", {
        name: "输出",
        exact: true,
      });
      assert.equal(await output.getAttribute("aria-expanded"), "false");
      await output.click();
      assert.equal(await output.getAttribute("aria-expanded"), "true");
      assert.equal(
        await trajectory.locator("ul > li").count(),
        1,
        "official log row is the list item",
      );
      await trajectory
        .getByRole("button", { name: "更早轨迹", exact: true })
        .click();
      await trajectory
        .getByText("FIXTURE older detail", { exact: true })
        .waitFor();
      await page.screenshot({
        path: `/tmp/loom-shared-trajectory-${width}.png`,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        aggregateMembers: members.length,
        scopeFiltered: true,
        singleFilterAndPagination: true,
        combinedModelEditor: true,
        actionIconsAndConfirmCancel: true,
        batchStopEnableReset:
          width === 390 ? "passed on two fixture instances" : "not-run",
        instancesInProfile: true,
        sharedInstanceTimeline: true,
        expansionAndPagination: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
