import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

export async function verifyNativeChannelLifecycle({
  browser,
  origin,
  workspace,
  client,
  role,
  head,
}) {
  const out =
    process.env.LOOM_WEB123_CHANNEL_EVIDENCE ?? "/tmp/loom-web123-channel";
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const width of [1440, 390]) {
    const { room } = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "channel-lifecycle-" + width,
      kind: "channel",
      name: "lifecycle-" + width,
      slug: "lifecycle-" + width,
    });
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      locale: "zh-CN",
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => errors.push(e.message));
    const list = () =>
      client.request("room.list", { workspaceId: workspace.workspaceId });
    const catalog = () =>
      client.request("role.list", { controlRoomId: workspace.controlRoomId });
    async function until(check, message) {
      const end = Date.now() + 12000;
      while (!(await check())) {
        assert.ok(Date.now() < end, message);
        await page.waitForTimeout(40);
      }
    }
    const settings = async () => {
      await page.getByTestId("composer-textarea").waitFor();
      await page
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      await page.getByTestId("channel-overflow-members-entry").waitFor();
    };
    const confirm = page
      .locator('[data-slot="dialog-content"]')
      .filter({ visible: true });
    try {
      await page.goto(
        origin + "/s/" + workspace.slug + "/channel/" + room.roomId,
      );
      await settings();
      // The original drawer opens its own staged member page, not a Loom replacement.
      await page.getByTestId("channel-overflow-members-add-tile").click();
      await page.getByTestId("add-candidate-agent-" + role.roleId).click();
      await page.getByTestId("add-member-confirm").click();
      await until(
        async () =>
          (await catalog()).instances.some((i) => i.channelId === room.roomId),
        "native add-members did not create an instance",
      );
      const instance = (await catalog()).instances.find(
        (i) => i.channelId === room.roomId,
      );
      const agent = (
        await client.request("agent.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).agents.find((a) => a.definition.agentId === instance.agentId);
      const instanceName = agent.currentRevision.displayName ?? agent.handle;
      await page
        .getByTestId("member-page-section-agents-panel")
        .getByText(instanceName, { exact: true })
        .waitFor();
      await page.screenshot({ path: out + "/members-" + width + ".png" });
      // A known SDK rejection must keep native confirmation/error state, never report success.
      let rejectOnce = true;
      await page.route("**/v3/client/rooms/members/remove", async (route) => {
        if (rejectOnce) {
          rejectOnce = false;
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "forbidden",
                message: "成员移除被拒绝（验收注入）",
              },
            }),
          });
        } else await route.continue();
      });
      await page
        .getByTestId("member-page-section-agents-panel")
        .getByText(instanceName, { exact: true })
        .hover();
      await page
        .getByRole("button", { name: "移除 " + instanceName, exact: true })
        .click();
      await confirm.getByRole("button", { name: "移除", exact: true }).click();
      await confirm.getByText(/成员移除被拒绝/).waitFor();
      assert.ok(
        (await catalog()).instances.some(
          (i) => i.instanceId === instance.instanceId,
        ),
      );
      await confirm.getByRole("button", { name: "移除", exact: true }).click();
      await confirm.waitFor({ state: "hidden" });
      await until(
        async () =>
          !(await catalog()).instances.some(
            (i) => i.instanceId === instance.instanceId,
          ),
        "native remove did not remove membership",
      );
      await page.unroute("**/v3/client/rooms/members/remove");
      await page.getByTestId("member-page-back").click();
      await page.getByTestId("channel-overflow-stop-agents").click();
      const sos = page.locator('[data-slot="dialog-card"]');
      await sos.getByRole("button", { name: "停止", exact: true }).click();
      await sos.getByText("所有 Agent 均已停止。", { exact: true }).waitFor();
      assert.equal(
        (await client.request("room.execution.read", { roomId: room.roomId }))
          .operation.state,
        "stopped",
      );
      const guidance = "Human correction from native SOS " + width;
      const resumedInput = page.waitForRequest(
        (r) =>
          r.url().endsWith("/v3/client/rooms/sos/resume") &&
          r.method() === "POST",
      );
      await sos.locator("textarea").fill(guidance);
      await sos.getByRole("button", { name: "全部恢复", exact: true }).click();
      assert.equal((await resumedInput).postDataJSON().guidance, guidance);
      await sos.waitFor({ state: "hidden" });
      assert.equal(
        (await client.request("room.execution.read", { roomId: room.roomId }))
          .operation,
        null,
      );
      await page.getByTestId("channel-settings-archive-action").click();
      await confirm.getByRole("button", { name: "归档", exact: true }).click();
      await confirm.waitFor({ state: "hidden" });
      await until(
        async () =>
          (await list()).rooms.some(
            (r) => r.roomId === room.roomId && r.archivedAt,
          ),
        "archive not persisted",
      );
      // Archived channels remain readable. Reload proves the state is durable.
      await page.goto(
        origin + "/s/" + workspace.slug + "/channel/" + room.roomId,
      );
      await page
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      await page.getByTestId("channel-settings-archive-action").click();
      await until(
        async () =>
          (await list()).rooms.some(
            (r) => r.roomId === room.roomId && !r.archivedAt,
          ),
        "unarchive not persisted",
      );
      await page
        .getByTestId("channel-settings-sheet")
        .waitFor({ state: "hidden" });
      await settings();
      // Permanent deletion must also remove retained removed-instance records and private boxes.
      await page.getByTestId("channel-settings-delete-action").click();
      await confirm.getByRole("button", { name: "删除", exact: true }).click();
      await confirm.waitFor({ state: "hidden" });
      await until(
        async () => !(await list()).rooms.some((r) => r.roomId === room.roomId),
        "delete not persisted",
      );
      assert.ok((await catalog()).roles.some((r) => r.roleId === role.roleId));
      assert.ok(
        !(await catalog()).instances.some((i) => i.channelId === room.roomId),
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        nativeMemberAdd: true,
        rejectedRemovalKeepsConfirmation: true,
        memberRemoval: true,
        durableSosStopAndResume: true,
        exactHumanGuidance: true,
        archiveAndReload: true,
        unarchive: true,
        permanentDelete: true,
        reusableRoleRetained: true,
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
