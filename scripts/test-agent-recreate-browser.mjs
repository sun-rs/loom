import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { roleBrowserFixture } from "./role-browser-fixture.mjs";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const { post, workspace, head, channel, createRole, instantiate } =
    await roleBrowserFixture(page, fixture);
  const room = await channel("fake-recreate");
  const role = await createRole("RecreatedFixture");
  const first = await instantiate(role, room);
  const old = (await post("agents/get", { agentId: first.agentId })).agent;
  const oldId = old.definition.agentId;
  const name = old.currentRevision.displayName;
  const direct = async (peerPrincipalId) =>
    (
      await post("rooms/direct/open", {
        workspaceId: workspace.workspaceId,
        peerPrincipalId,
        basedOnControlRoomSeq: await head(),
        idempotencyKey: crypto.randomUUID(),
      })
    ).room;
  const oldRoom = await direct(old.definition.participantId);
  await page.goto(`${fixture.origin}/?room=${oldRoom.roomId}`);
  const composer = page.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  await composer.fill(
    `@${old.handle} Fixture: reply to verify historical identity after recreation`,
  );
  await composer.press("Enter");
  await page
    .locator(".rah-message-avatar-trigger:has(.rah-agent-avatar)")
    .first()
    .waitFor({ timeout: 30000 });
  await post("agents/manage", {
    action: "set_state",
    state: "disabled",
    agentId: oldId,
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  await post("agents/manage", {
    action: "set_state",
    state: "tombstoned",
    agentId: oldId,
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const second = await instantiate(role, room);
  const created = await post("agents/get", { agentId: second.agentId });
  assert.notEqual(second.agentId, oldId);
  assert.notEqual(second.instanceId, first.instanceId);
  assert.notEqual(created.agent.handle, old.handle);
  assert.equal(created.agent.currentRevision.displayName, name);
  const newRoom = await direct(created.agent.definition.participantId);
  assert.notEqual(newRoom.roomId, oldRoom.roomId);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${fixture.origin}/?room=${oldRoom.roomId}`);
    await expect(
      page.locator(".rah-agent-deleted-badge").first(),
    ).toBeVisible();
    const oldAvatar = page
      .locator(".rah-message-avatar-trigger:has(.rah-agent-avatar)")
      .first();
    await expect(oldAvatar.locator(".rah-agent-avatar")).toHaveCSS(
      "filter",
      "grayscale(1)",
    );
    const oldMention = page
      .locator(".rah-rich-agent-reference")
      .filter({ hasText: `@${name}` })
      .first();
    await oldMention.click();
    await expect(page.locator(".rah-agent-unavailable")).toBeVisible();
    await page
      .getByRole("button", {
        name: width < 768 ? "返回聊天" : "关闭 Agent 详情",
        exact: true,
      })
      .click();
    await oldAvatar.click();
    await expect(page.locator(".rah-agent-unavailable")).toBeVisible();
    await page
      .getByRole("button", {
        name: width < 768 ? "返回聊天" : "关闭 Agent 详情",
        exact: true,
      })
      .click();
    await page.reload();
    await expect(oldAvatar.locator(".rah-agent-avatar")).toHaveCSS(
      "filter",
      "grayscale(1)",
    );
    await page.screenshot({
      path: `/tmp/rah-agent-recreate-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
    });
    await page.goto(`${fixture.origin}/?room=${newRoom.roomId}`);
    await expect(
      page.locator(".rah-conversation-head .rah-agent-deleted-badge"),
    ).toHaveCount(0);
    await expect(page.locator(".rah-conversation-head h1")).toHaveText(name);
  }
  const rooms = (
    await post("rooms/list", { workspaceId: workspace.workspaceId })
  ).rooms;
  assert.ok(rooms.some((room) => room.roomId === oldRoom.roomId));
  assert.ok(rooms.some((room) => room.roomId === newRoom.roomId));
  console.log(
    "same-name creation, separate IDs/DMs, historical grayscale/unavailable and reload passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
