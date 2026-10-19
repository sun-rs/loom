import assert from "node:assert/strict";
import { showChatList } from "./mobile-chat-browser.mjs";
export async function verifyStandalone({
  browser,
  origin,
  client,
  workspace,
  role,
  channels,
  instances,
  head,
}) {
  const old = await client.request("room.direct.open", {
    workspaceId: workspace.workspaceId,
    peerPrincipalId: instances[1].instanceId,
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "solo-old-box",
  });
  await client.request("room.member.remove", {
    roomId: channels[2].roomId,
    principalId: instances[1].instanceId,
    basedOnRoomSeq: await head(channels[2].roomId),
    idempotencyKey: "solo-remove-old",
  });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [],
        creates = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/v3/client/rooms/create", async (route) => {
        creates.push(route.request().postDataJSON());
        if (creates.length === 1) {
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await page.goto(`${origin}/?view=agents&role=${role.roleId}`);
      await page
        .getByRole("button", { name: "开始独立单聊", exact: true })
        .click();
      await page.getByRole("button", { name: "开始聊天", exact: true }).click();
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .waitFor();
      assert.equal(creates.length, 1);
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(creates[0], creates[1]);
      const roomId = new URL(page.url()).searchParams.get("room");
      assert.ok(roomId);
      assert.ok(!channels.some((r) => r.roomId === roomId));
      const catalog = await client.request("role.list", {
        controlRoomId: workspace.controlRoomId,
      });
      const own = catalog.instances.filter((i) => i.channelId === roomId);
      assert.equal(own.length, 1);
      assert.equal(own[0].roleId, role.roleId);
      assert.ok(!instances.some((i) => i.instanceId === own[0].instanceId));
      for (const id of ["chat", "tasks", "workspace"])
        await page.getByTestId(`panel-tab-${id}`).waitFor();
      await page.getByRole("tab", { name: "任务", exact: true }).click();
      await page.getByTestId("loom-tasks-page").waitFor();
      await page.getByTestId("panel-tab-workspace").click();
      await page.getByTestId("channel-workspace").waitFor();
      await page.getByRole("tab", { name: "聊天", exact: true }).click();
      await page.getByTestId("chat-composer-shell").waitFor();
      await page.screenshot({ path: `/tmp/loom-standalone-chat-${width}.png` });
      await showChatList(page);
      const row = page.locator(
        `[data-sidebar-section="dms"] [data-sidebar-channel-id="${roomId}"]`,
      );
      await row.waitFor();
      assert.equal(
        await page
          .locator(`[data-sidebar-channel-id="${old.room.roomId}"]`)
          .count(),
        0,
      );
      await page.reload();
      await showChatList(page);
      await row.waitFor();
      await row.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "标记已读", exact: true })
        .click();
      await page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/v3/client/sidebar/get",
      );
      await row.click({ button: "right" });
      await page
        .getByRole("menuitem", { name: "关闭会话", exact: true })
        .click();
      await row.waitFor({ state: "hidden" });
      await page.goto(`${origin}/?room=${roomId}`);
      await showChatList(page);
      await row.waitFor();
      await page.goto(`${origin}/?room=${channels[2].roomId}`);
      await page.getByTestId("loom-channel-control-trigger").click();
      const history = page.getByTestId("channel-private-history");
      await history
        .getByText("实例已移除 · 历史只读", { exact: true })
        .waitFor();
      await history.getByText(old.room.name, { exact: true }).click();
      await page
        .getByText("此私聊已停用，历史只读。", { exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("room"),
        old.room.roomId,
      );
      await page.screenshot({
        path: `/tmp/loom-standalone-history-${width}.png`,
      });
      assert.deepEqual(errors, []);
      results.push({
        width,
        newRoomAndInstance: true,
        exactUnknownReplay: true,
        normalTabs: true,
        durableDmPlacement: true,
        oldInactiveHistoryAccessible: true,
        errors,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
