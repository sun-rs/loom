import { showChatList, openChatRow } from "./mobile-chat-browser.mjs";
import assert from "node:assert/strict";
// Explicit response fixture for exceptional UI states; real Kernel mutation is
// independently covered by blocked-work.test.ts and native-final-human-recovery.
export async function verifyBlockedWork(
  page,
  panel,
  { instanceId, roomId, viewport, name },
) {
  // Establish real in-app history before opening the operation.
  await panel
    .getByRole("button", {
      name: viewport.width < 768 ? "返回聊天" : "关闭实例详情",
      exact: true,
    })
    .click();
  await showChatList(page);
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await nav
    .getByRole("button", {
      name: viewport.width < 768 ? "首页" : "频道",
      exact: true,
    })
    .click();
  await openChatRow(page, roomId);
  await page.getByTestId("loom-channel-control-trigger").click();
  await page
    .getByTestId("loom-channel-control-sheet")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click({ timeout: 5000 });
  await panel.waitFor({ timeout: 5000 }).catch(async (error) => {
    console.error(
      "MEMBER PROFILE FIXTURE",
      page.url(),
      await page.locator("body").innerText(),
    );
    throw error;
  });
  const block = {
    activationId: "fixture-blocked-work",
    roomId,
    holdsLane: true,
    reason: "FIXTURE 新 Human 消息使旧回复暂停",
  };
  let current = block;
  await page.route("**/v3/client/rooms/agents/activity/list", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const a of data.agents)
      if (a.participantId === instanceId) {
        if (current) a.blocked = current;
        else delete a.blocked;
      }
    await route.fulfill({ response, json: data });
  });
  const action = panel.getByRole("button", {
    name: "处理阻塞工作",
    exact: true,
  });
  await action.waitFor({ timeout: 10000 }).catch(async (error) => {
    console.error(
      "BLOCKED FIXTURE",
      page.url(),
      await page.locator("body").innerText(),
    );
    throw error;
  });
  await action.click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "放弃本次阻塞工作" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await action.isVisible());
  await action.click();
  await page.screenshot({
    path: `/tmp/loom-blocked-work-${viewport.width}.png`,
    animations: "disabled",
  });
  const calls = [];
  await page.route(
    "**/v3/client/instances/activation/abandon",
    async (route) => {
      const request = route.request().postDataJSON();
      calls.push(request);
      if (calls.length === 1) {
        current = undefined;
        await route.abort();
        return;
      }
      await route.fulfill({
        json: {
          instanceId,
          channelId: roomId,
          activationId: block.activationId,
          deduplicated: true,
          event: {
            eventId: "fixture-abandon",
            schemaVersion: 1,
            roomId,
            roomSeq: 1,
            actorId: "fixture-human",
            aggregateId: instanceId,
            aggregateType: "instance",
            type: "instance.activation_abandoned",
            payload: {},
            createdAt: "2026-10-15T00:00:00Z",
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
    },
  );
  await dialog.getByRole("button", { name: "确认放弃", exact: true }).click();
  await dialog.getByRole("button", { name: "核实操作结果" }).waitFor();
  await page.keyboard.press("Escape");
  assert.ok(await dialog.isVisible());
  await page.goBack();
  await dialog.getByRole("button", { name: "核实操作结果" }).waitFor();
  assert.equal(calls.length, 1);
  await dialog.getByRole("button", { name: "核实操作结果" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 5000 });
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].activationId, block.activationId);
  assert.equal(calls[0].instanceId, instanceId);
  await panel
    .getByText(
      "已放弃本次工作。处理原因后，请发送新的请求；旧回复不会自动重发。",
      { exact: true },
    )
    .waitFor();
  await action.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.unroute("**/v3/client/instances/activation/abandon");
  await page.unroute("**/v3/client/rooms/agents/activity/list");
}
