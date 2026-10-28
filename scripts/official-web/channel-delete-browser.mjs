import assert from "node:assert/strict";
export async function verifyChannelDelete({
  browser,
  origin,
  client,
  workspace,
  head,
  channels,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const { room } = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "delete-fixture-" + width,
      kind: "channel",
      name: "FIXTURE delete " + width,
      slug: "delete-fixture-" + width,
    });
    const context = await browser.newContext({
        viewport: { width, height: 844 },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(10000);
    const payloads = [];
    try {
      await page.goto(origin + "/?room=" + room.roomId);
      await page.getByTestId("loom-channel-control-trigger").click();
      const stop = page.getByTestId("channel-overflow-stop-agents");
      assert.equal(
        await stop
          .locator('[data-slot="button-content"]')
          .evaluate((el) => getComputedStyle(el).justifyContent),
        "center",
      );
      const trigger = page.getByTestId("channel-delete-trigger");
      await trigger.waitFor();
      assert.equal(await trigger.isEnabled(), true);
      await trigger.click();
      await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: "取消", exact: true })
        .click();
      assert.ok(
        (
          await client.request("room.list", {
            workspaceId: workspace.workspaceId,
          })
        ).rooms.some((r) => r.roomId === room.roomId),
      );
      await trigger.click();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-testid="channel-delete-confirm"]')
            ?.disabled,
      );
      await client.request("message.post", {
        roomId: room.roomId,
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: "delete-stale-" + width,
        body: "FIXTURE new fact",
        recipients: [],
      });
      await page.getByTestId("channel-delete-confirm").click();
      await page
        .getByText(
          "频道未删除：状态已变化或执行尚未确认停止。已发出的停止请求会继续处理；请稍后关闭并重新确认删除。",
          { exact: true },
        )
        .waitFor();
      assert.equal(
        await page.getByTestId("channel-delete-confirm").isDisabled(),
        true,
      );
      await page
        .getByRole("dialog")
        .last()
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page
        .getByTestId("loom-channel-control-sheet")
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByTestId("loom-channel-control-trigger").click();
      await trigger.waitFor();
      await page.route("**/v3/client/rooms/delete", async (route) => {
        payloads.push(route.request().postDataJSON());
        if (payloads.length === 1) {
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
        } else await route.continue();
      });
      await trigger.click();
      await page.getByTestId("channel-delete-confirm").click();
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .last()
        .click();
      await page
        .getByTestId("channel-delete-confirm")
        .waitFor({ state: "hidden" });
      assert.equal(payloads.length, 2);
      assert.deepEqual(payloads[0], payloads[1]);
      assert.equal(
        (
          await client.request("room.list", {
            workspaceId: workspace.workspaceId,
          })
        ).rooms.some((r) => r.roomId === room.roomId),
        false,
      );
      await page.goto(origin + "/?room=" + channels[2].roomId);
      await page.getByTestId("loom-channel-control-trigger").click();
      assert.equal(await page.getByTestId("channel-delete-trigger").isEnabled(),true);
      await page.getByTestId("channel-delete-trigger").click();
      await page.getByText(/所有实例、私密会话、消息和附件记录/).waitFor();
      await page.getByRole("dialog").last().getByRole("button",{name:"取消",exact:true}).click();
      results.push({
        width,
        cancelPreserves: true,
        staleRejects: true,
        instanceChannelEnabledWithCascadeWarning: true,
        deleted: true,
        unknownExactReplay: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
