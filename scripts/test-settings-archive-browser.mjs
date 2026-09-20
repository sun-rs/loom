import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browserName = process.env.RAH_BROWSER ?? "chromium";
const browser = await (browserName === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(
    `${fixture.origin}/?surface=settings&settingsSection=account`,
  );
  await page
    .getByRole("textbox", { name: "显示名称", exact: true })
    .fill("Sun Fixture");
  const profileSaved = page.waitForResponse((response) =>
    response.url().endsWith("/principals/update"),
  );
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  assert.equal((await profileSaved).status(), 200);
  let activitySummary;
  page.on("response", async (response) => {
    if (response.url().includes("/v3/client/activity/list") && response.ok()) {
      activitySummary = (await response.json()).summary;
    }
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${fixture.origin}/?surface=room`);
    const row = page
      .locator(".rah-sidebar-channel-entry button")
      .filter({ hasText: "Agent Council" })
      .first();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toHaveAccessibleName("归档频道");
    await expect(confirmation).toHaveCSS("max-width", "384px");
    await expect(confirmation.locator("header")).toHaveCSS(
      "border-bottom-width",
      "0px",
    );
    await expect(
      confirmation.getByRole("button", { name: "归档频道", exact: true }),
    ).toHaveCSS("background-color", "rgb(248, 161, 111)");
    await expect(confirmation).toHaveCSS("padding", "24px");
    await expect(confirmation.locator("header h2")).toHaveCSS(
      "font-size",
      "18px",
    );
    await expect(confirmation.locator("footer")).toHaveCSS("gap", "12px");
    await expect(confirmation.locator("p").first()).toHaveCSS(
      "font-size",
      "14px",
    );
    await expect(confirmation.locator("footer .btn").first()).toHaveCSS(
      "height",
      "28px",
    );
    for (const resizedWidth of [320, 600, 1440, width]) {
      await page.setViewportSize({ width: resizedWidth, height: 844 });
      await expect(confirmation).toBeVisible();
      const resized = await confirmation.boundingBox();
      assert.ok(
        resized.x >= 16 && resized.x + resized.width <= resizedWidth - 16,
      );
      await expect(
        page.locator(".rah-room-archive-confirm .rah-dialog-backdrop"),
      ).toBeVisible();
    }
    const box = await confirmation.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.screenshot({ path: `/tmp/rah-archive-dialog-${width}.png` });
    await confirmation
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  // Explicitly read the seeded membership notices before testing new archive events.
  await page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Agent Council" })
    .first()
    .click();

  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .click();
  await page
    .locator(".rah-channel-settings-operations .rah-channel-archive-button")
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .getByRole("button", { name: "归档频道", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .waitFor({ state: "detached" });
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  const archives = page.getByRole("region", { name: "已归档频道" });
  await archives.waitFor();
  const card = archives.locator(".rah-settings-archive-row").first();
  await expect(card).toHaveCSS("padding", "12px 16px");
  await expect(card).toHaveCSS("border-width", "2px");
  const compactRestore = archives.getByRole("button", {
    name: "取消归档",
    exact: true,
  });
  await expect(compactRestore).toHaveCSS("height", "28px");
  await expect(compactRestore).toHaveCSS("font-size", "12px");
  await expect(compactRestore).toHaveCSS("line-height", "12px");
  await expect(compactRestore).toHaveCSS("padding-left", "10px");
  await expect(compactRestore.locator("svg")).toHaveCSS("width", "14px");
  await expect(page.getByText(/本地版服务器即当前协作空间/)).toHaveCount(0);

  const archiveName = archives.locator(".rah-settings-archive-name").first();
  await expect(archiveName).toHaveCSS("text-decoration-line", "underline");
  await expect(archiveName).toHaveCSS("text-decoration-thickness", "2px");
  await expect(archiveName).toHaveCSS("text-underline-offset", "2px");
  await expect(archiveName).toHaveCSS("text-decoration-skip-ink", "auto");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(archiveName).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-archive-underline-${browserName}-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 844 });
  const deleteIcon = archives.getByRole("button", {
    name: "删除频道 Agent Council",
    exact: true,
  });
  await expect(deleteIcon).toBeVisible();
  await expect(deleteIcon).toHaveText("");
  await expect(deleteIcon.locator("use")).toHaveAttribute(
    "href",
    /#raft-icon-trash-2$/,
  );
  await expect(deleteIcon).toHaveCSS("background-color", "rgb(249, 114, 100)");
  const restoreButton = archives.getByRole("button", {
    name: "取消归档",
    exact: true,
  });
  assert.equal(
    (await deleteIcon.boundingBox()).height,
    (await restoreButton.boundingBox()).height,
  );
  assert.equal(
    (await deleteIcon.locator("svg").boundingBox()).height,
    (await restoreButton.locator("svg").boundingBox()).height,
  );
  await archives.locator(".rah-settings-archive-name").first().click();
  await expect(
    page.locator("main.channel .rah-conversation-head"),
  ).toBeVisible();
  await expect(page.locator(".rah-channel-archived-badge")).toHaveText(
    "已归档",
  );
  await expect(page.locator("main.channel form.composer")).toHaveCount(0);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " archived this channel" }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const badge = page.locator(".rah-channel-archived-badge");
    await expect(badge).toBeVisible();
    const box = await badge.boundingBox();
    const title = await page
      .locator("main.channel .channel-title h1")
      .boundingBox();
    assert.ok(
      Math.abs(box.x - (title.x + title.width) - 8) < 1,
      "archive badge follows title with an 8px gap",
    );
    assert.ok(
      Math.abs(box.y + box.height / 2 - title.y - title.height / 2) < 1,
      "archive badge shares title row",
    );
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await expect(page.locator(".rah-channel-archived-notice")).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-archived-view-${browserName}-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".rah-channel-archived-notice button").click();
  await expect(
    page.getByRole("button", { name: "添加成员", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "设为私密", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "删除频道", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "管理成员", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "添加成员", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回频道设置", exact: true }).click();
  await expect(
    page
      .locator(".rah-channel-settings-operations")
      .getByRole("button", { name: "取消归档频道", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".rah-channel-archived-badge")).toBeVisible();
  await page
    .locator(".rah-channel-settings-operations")
    .getByRole("button", { name: "取消归档频道", exact: true })
    .click();
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeEnabled();
  await expect(page.locator("main.channel .rah-panel-title")).toHaveText(
    "Agent Council",
  );
  await expect(page.locator(".rah-channel-settings-layer")).toHaveCount(0);
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount,
    )
    .toBe(1);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " unarchived this channel" }),
  ).toBeVisible();
  const unreadChannel = page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Agent Council" })
    .first();
  await page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Task Matrix" })
    .first()
    .click();
  await expect(unreadChannel).not.toHaveClass(/is-selected/);
  await expect(unreadChannel).toHaveCSS("font-weight", "700");
  await expect(unreadChannel.locator(".rah-sidebar-channel-name")).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(unreadChannel.locator(".rah-room-unread")).toHaveText("1");
  await page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Agent Council" })
    .first()
    .click();
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount ?? 0,
    )
    .toBe(0);
  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .click();
  await page
    .locator(".rah-channel-settings-operations .rah-channel-archive-button")
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .getByRole("button", { name: "归档频道", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "归档频道", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".rah-channel-archived-badge")).toBeVisible();
  await page.reload();
  await expect(page.locator(".rah-channel-archived-notice")).toBeVisible();
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  await archives.getByRole("button", { name: "取消归档", exact: true }).click();
  await archives.waitFor({ state: "detached" });
  assert.match(page.url(), /surface=settings/);
  await page.reload();
  await page
    .getByRole("heading", { name: "服务器资料", exact: true })
    .waitFor();
  assert.equal(await archives.count(), 0);
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount,
    )
    .toBe(1);
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeEnabled();
  await expect(page.locator(".rah-channel-archived-badge")).toHaveCount(0);
  const systemGroup = page.getByRole("button", { name: /有 \d+ 条系统消息/ });
  await expect(systemGroup).toHaveAttribute("aria-expanded", "false");
  await systemGroup.click();
  await expect(systemGroup).toHaveAttribute("aria-expanded", "true");
  const notices = page.locator(".rah-chat-system-notice");
  await expect(notices.first()).toBeVisible();
  for (const notice of await notices.all()) {
    await expect(notice.locator("time")).toHaveCount(1);
    await expect(notice.locator("time")).toHaveAttribute("datetime", /T/);
    await expect(notice.locator("time")).toContainText(/\d{2}:\d{2}/);
  }

  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(systemGroup).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-system-group-${browserName}-${width}.png`,
    });
  }
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " unarchived this channel" }),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: "Sun Fixture unarchived this channel" }),
  ).toHaveCount(2);
  await systemGroup.click();
  await expect(systemGroup).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount,
    )
    .toBe(1);
  await page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Agent Council" })
    .first()
    .click();
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount ?? 0,
      { timeout: 12000 },
    )
    .toBe(0);
  await page.reload();
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeEnabled();
  await expect
    .poll(
      () =>
        activitySummary?.rooms.find((room) => room.roomId === fixture.roomId)
          ?.unreadCount ?? 0,
    )
    .toBe(0);
  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .click();
  await page
    .locator(".rah-channel-settings-operations .rah-channel-archive-button")
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .getByRole("button", { name: "归档频道", exact: true })
    .click();
  await expect(page.locator(".rah-channel-archived-badge")).toBeVisible();
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await deleteIcon.click();
    const dialog = page.getByRole("dialog", { name: "删除频道", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(deleteIcon).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-archive-delete-${browserName}-${width}.png`,
    });
  }
  await deleteIcon.click();
  await page
    .getByRole("dialog", { name: "删除频道", exact: true })
    .getByRole("button", { name: "永久删除", exact: true })
    .click();
  await archives.waitFor({ state: "detached" });
  assert.match(page.url(), /surface=settings/);
  await page.reload();
  await page
    .getByRole("heading", { name: "服务器资料", exact: true })
    .waitFor();
  await expect(archives).toHaveCount(0);
  console.log(
    "Archived channel: real Kernel archive, Settings preview, unarchive, reload and writable Room passed.",
  );
} finally {
  await browser.close();
  await fixture.close();
}
