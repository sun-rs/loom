import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data) => {
    const response = await page.request.post(
      fixture.origin + "/v3/client/" + path,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const seq = (
    await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "role-mvp-gate",
      bootstrap: "latest",
    })
  ).latestRoomSeq;
  const channel = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: seq,
      kind: "channel",
      name: "Role MVP fixture",
      slug: "role-mvp-fixture",
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  await page.goto(fixture.origin + "/?surface=agents");
  await page.getByRole("button", { name: "Role 管理", exact: true }).click();
  await page.getByRole("button", { name: "创建 Role", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "创建 ROLE" }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/rah-role-create-desktop.png" });
  await dialog.locator("input").first().fill("MVP Reviewer");
  await dialog.getByRole("button", { name: /^运行时：/ }).click();
  await page.getByRole("menuitemradio").first().click();
  await dialog.getByRole("button", { name: /^模型：/ }).click();
  await page
    .getByRole("menuitemradio")
    .filter({ hasNotText: "自定义" })
    .first()
    .click();
  await dialog.getByRole("button", { name: "创建 Role", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Role 管理", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "MVP Reviewer", exact: true }),
  ).toBeVisible();
  await page.getByLabel("实例所在频道").selectOption(channel.roomId);
  await page.getByRole("button", { name: "加入频道", exact: true }).click();
  await expect(page.getByText("实例已加入频道", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加入频道", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "/tmp/rah-role-mvp-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/rah-role-mvp-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture.origin + "/?room=" + channel.roomId);
  const agent = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents.find((a) => a.currentRevision.displayName === "MVP Reviewer");
  assert.ok(agent);
  await expect(
    page.locator(".rah-direct-room-row").filter({ hasText: "MVP Reviewer" }),
  ).toHaveCount(0);
  for (let round = 0; round < 2; round++) {
    const composer = page.locator("main.channel form.composer textarea");
    await composer.fill("你好，这是 MVP 测试 " + round);
    await composer.press("Enter");
    await expect
      .poll(
        async () => {
          const result = await post("messages/list", {
            roomId: channel.roomId,
          });
          return result.messages.filter(
            (m) => m.actorId === agent.definition.participantId,
          ).length;
        },
        { timeout: 60000 },
      )
      .toBeGreaterThanOrEqual(round + 1);
    if (round === 0) await page.reload();
  }
  const replies = (
    await post("messages/list", { roomId: channel.roomId })
  ).messages.filter((m) => m.actorId === agent.definition.participantId);
  await expect(
    page.locator('[data-message-id="' + replies.at(-1).messageId + '"]'),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: "/tmp/rah-role-mvp-two-rounds.png" });
  await page
    .getByRole("button", { name: "查看 MVP Reviewer 动态", exact: true })
    .last()
    .click();
  const inspector = page.locator(".rah-agent-peek");
  const openPrivate = async () => {
    await page.screenshot({ path: "/tmp/rah-role-private-before.png" });
    const message = inspector.getByRole("button", {
      name: "给 MVP Reviewer 发消息",
      exact: true,
    });
    if (await message.isVisible()) await message.click();
    else {
      await inspector
        .getByRole("button", { name: "更多操作", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "聊天", exact: true }).click();
    }
  };

  await expect(inspector).toBeVisible();
  await openPrivate();
  await expect(inspector.getByRole("note")).toContainText("私聊");
  const privateComposer = inspector.locator("form.composer textarea");
  const privateBox = (
    await post("rooms/direct/open", {
      workspaceId: workspace.workspaceId,
      peerPrincipalId: agent.definition.participantId,
      basedOnControlRoomSeq: 0,
      idempotencyKey: "reopen-private-gate",
    })
  ).room;

  for (let round = 0; round < 2; round++) {
    await expect(privateComposer).toBeEnabled();
    await privateComposer.fill("私聊独立消息 " + round);
    await privateComposer.press("Enter");
    await expect
      .poll(
        async () =>
          (
            await post("messages/list", { roomId: privateBox.roomId })
          ).messages.filter((m) => m.actorId === agent.definition.participantId)
            .length,
        { timeout: 60000 },
      )
      .toBeGreaterThanOrEqual(round + 1);
    await expect(
      inspector.locator(".messages").getByText(/Fake CLI/),
    ).toHaveCount(round + 1);
  }
  await expect(
    page.locator("main.channel form.composer textarea").first(),
  ).toBeVisible();
  await expect(
    page.locator(".rah-direct-room-row").filter({ hasText: "MVP Reviewer" }),
  ).toHaveCount(0);
  await page.screenshot({ path: "/tmp/rah-role-private-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(privateComposer).toBeVisible();
  await page.screenshot({ path: "/tmp/rah-role-private-mobile.png" });
  await inspector
    .getByRole("button", { name: "返回聊天", exact: true })
    .click();
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page
    .getByRole("button", { name: "查看 MVP Reviewer 动态", exact: true })
    .last()
    .click();
  await openPrivate();
  await expect(
    inspector.getByText("私聊独立消息 1", { exact: true }),
  ).toBeVisible();
  const publicMessages = (
    await post("messages/list", { roomId: channel.roomId })
  ).messages;
  assert.ok(!publicMessages.some((m) => m.body.includes("私聊独立消息")));
  await page.goto(fixture.origin + "/?surface=agents");
  await page.getByRole("button", { name: "Role 管理", exact: true }).click();
  await page.getByRole("button", { name: "编辑 Role", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "编辑 ROLE" }),
  ).toBeVisible();
  await dialog.getByLabel("角色指令").fill("只检查无障碍问题，不修改代码。");
  await dialog.getByRole("button", { name: "保存 Role", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("使用旧版本", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Role 管理", exact: true }).click();
  await expect(page.getByText("使用旧版本", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑 Role", exact: true }).click();
  await expect(dialog.getByLabel("角色指令")).toHaveValue(
    "只检查无障碍问题，不修改代码。",
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const existingAgent = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents.find((a) => a.definition.agentId === agent.definition.agentId);
  assert.equal(
    existingAgent.currentRevision.instructions,
    agent.currentRevision.instructions,
  );
  await page.getByLabel("实例所在频道").selectOption(channel.roomId);
  await page.getByRole("button", { name: "加入频道", exact: true }).click();
  await expect(page.getByText("当前版本", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/rah-role-revise-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/rah-role-revise-mobile.png" });
  console.log(
    "PASS: Role revision persists; old instance unchanged; new instance uses current revision.",
  );
  console.log(
    "PASS: UI Role creation, channel replies, private box two replies, reload, desktop/mobile.",
  );
} finally {
  await browser.close();
  await fixture.close();
}
