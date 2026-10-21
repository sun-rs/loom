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
        .getByRole("button", { name: "编辑模型与推理强度", exact: true })
        .click();
      await profile
        .getByRole("combobox", { name: "模型", exact: true })
        .waitFor();
      await profile
        .getByRole("combobox", { name: "推理强度", exact: true })
        .waitFor();
      await profile
        .getByRole("combobox", { name: "模型", exact: true })
        .click();
      await page
        .getByRole("option", { name: "FIXTURE high model", exact: true })
        .click();
      assert.match(
        await profile
          .getByRole("combobox", { name: "推理强度", exact: true })
          .innerText(),
        /high/,
      );
      await profile
        .getByRole("combobox", { name: "模型", exact: true })
        .click();
      await page
        .getByRole("option", { name: "FIXTURE no effort model", exact: true })
        .click();
      assert.equal(
        await profile
          .getByRole("combobox", { name: "推理强度", exact: true })
          .isDisabled(),
        true,
      );
      await profile.getByRole("button", { name: "取消", exact: true }).click();
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
        instancesInProfile: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
