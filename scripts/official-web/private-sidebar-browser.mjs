import assert from "node:assert/strict";
import { showChatList, openChatRow } from "./mobile-chat-browser.mjs";
export async function verifyPrivateSidebar({
  page,
  client,
  workspace,
  channel,
  boxId,
  instance,
  name,
}) {
  await showChatList(page);
  const row = page.locator(`[data-private-box-id="${boxId}"]`);
  await row.waitFor();
  assert.equal(await row.innerText(), name);
  assert.equal(
    await row.locator("[data-sidebar-avatar-badge]").count(),
    0,
    "no fabricated live status",
  );
  await row.click({ button: "right" });
  assert.equal(
    await page.getByRole("menuitem", { name: "归档", exact: true }).count(),
    0,
  );
  await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
  await page
    .locator(`[data-sidebar-section="pinned"] [data-private-box-id="${boxId}"]`)
    .waitFor();
  assert.ok(
    (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences.pinned.includes(`peer:${instance.instanceId}`),
  );
  await page.reload();
  await showChatList(page);
  await row.waitFor();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
  await page
    .locator(`[data-sidebar-section="dms"] [data-private-box-id="${boxId}"]`)
    .waitFor();
  await row.click();
  await page
    .getByRole("heading", { name: `私聊 · ${name}`, exact: true })
    .waitFor();
  await showChatList(page);
  await row.click({ button: "right" });
  const closes = [];
  await page.route("**/v3/client/sidebar/patch", async (route) => {
    closes.push(route.request().postDataJSON());
    if (closes.length === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("menuitem", { name: "关闭会话", exact: true }).click();
  await page
    .getByRole("button", { name: "核实操作结果", exact: true })
    .waitFor();
  assert.equal(closes.length, 1, "unknown close is not silently resent");
  assert.equal(new URL(page.url()).searchParams.get("room"), boxId);
  await page.getByRole("button", { name: "核实操作结果", exact: true }).click();
  await page
    .getByRole("button", { name: "核实操作结果", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(closes.length, 2);
  assert.deepEqual(
    closes[0],
    closes[1],
    "verification retains the exact close intent",
  );
  await page.unroute("**/v3/client/sidebar/patch");
  await row.waitFor({ state: "hidden" });
  assert.ok(
    (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences.hiddenDms.includes(`peer:${instance.instanceId}`),
  );
  assert.ok(
    (await client.request("message.list", { roomId: boxId, limit: 50 }))
      .messages.length,
    "closing preserves history",
  );
  await page.reload();
  await showChatList(page);
  assert.equal(await row.count(), 0);
  await openChatRow(page, channel.roomId);
  await page.getByRole("button", { name: "频道成员与状态" }).click();
  await page.getByRole("button", { name: `私聊 ${name}`, exact: true }).click();
  await page
    .getByRole("heading", { name: `私聊 · ${name}`, exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("room"), boxId);
  await showChatList(page);
  await row.waitFor();
  assert.equal(
    (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences.hiddenDms.includes(`peer:${instance.instanceId}`),
    false,
  );
  await row.click();
  await page.getByTestId("composer-textarea").waitFor({ state: "visible" });
}
