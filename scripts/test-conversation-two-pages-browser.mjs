import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const engine = process.env.RAH_BROWSER === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1000 },
  });
  page.setDefaultTimeout(12000);
  const post = async (path, data) => {
    const r = await page.request.post(f.origin + "/v3/client/" + path, {
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const agents = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents;
  const control = await post("rooms/sync", {
    roomId: workspace.controlRoomId,
    consumerId: "two-pages",
    bootstrap: "latest",
  });
  const dm = (
    await post("rooms/direct/open", {
      workspaceId: workspace.workspaceId,
      peerPrincipalId: agents[0].definition.participantId,
      basedOnControlRoomSeq: control.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  for (const [kind, roomId] of [
    ["room", f.roomId],
    ["dm", dm.roomId],
  ]) {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(f.origin + "/?room=" + roomId);
    const channel = page.locator(
      ".rah-product-shell > .channel:not(.rah-agent-peek)",
    );
    const thread = page.getByTestId("thread-side-column");
    const profile = page.locator(".rah-agent-peek");
    const composer = channel.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await composer.fill("Isolated Fake CLI two-page navigation fixture");
    await composer.press("Enter");
    const agentAvatar = channel
      .locator('.rah-message-avatar-trigger[aria-label$="动态"]')
      .first();
    await expect(agentAvatar).toBeVisible({ timeout: 20000 });
    const agentMessage = agentAvatar.locator("xpath=..");
    await agentMessage.hover();
    await agentMessage
      .getByRole("button", { name: "在消息列中回复", exact: true })
      .click();
    await expect(thread).toBeVisible();
    const reply = thread.getByRole("textbox", {
      name: "Thread 回复输入框",
      exact: true,
    });
    await reply.fill("Fixture human thread reply");
    await reply.press("Enter");
    await expect(reply).toHaveValue("");
    await composer.fill("Room draft retained");
    await reply.fill("Thread draft retained");
    if (kind === "room") {
      const beforeRoom = await channel.boundingBox(),
        beforeThread = await thread.boundingBox();
      await channel
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      const settings = page.locator(".rah-channel-settings-drawer");
      await expect(settings).toBeVisible();
      await expect(thread).toBeVisible();
      assert.deepEqual(
        await channel.boundingBox(),
        beforeRoom,
        "settings overlays without resizing Room",
      );
      assert.deepEqual(
        await thread.boundingBox(),
        beforeThread,
        "settings preserves Thread geometry",
      );
      const backdrop = page.locator(".rah-channel-settings-backdrop");
      assert.notEqual(
        await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgba(0, 0, 0, 0)",
      );
      await page.screenshot({
        animations: "disabled",
        path: `/tmp/rah-two-pages-${engine.name()}-settings.png`,
      });
      await page.keyboard.press("Escape");
      await expect(settings).toHaveCount(0);
      await expect(reply).toHaveValue("Thread draft retained");
    }
    if (kind === "room") {
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/navigation/resolve", async (route) => {
        if (route.request().postDataJSON().target?.kind === "agent") await held;
        await route.continue();
      });
      const requested = page.waitForRequest(
        (r) =>
          r.url().endsWith("/navigation/resolve") &&
          r.postDataJSON().target?.kind === "agent",
      );
      await agentAvatar.click();
      await requested;
      await agentMessage.hover();
      await agentMessage
        .getByRole("button", { name: "在消息列中回复", exact: true })
        .click();
      const completed = page.waitForResponse((r) =>
        r.url().endsWith("/navigation/resolve"),
      );
      release();
      await completed;
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await expect(profile).toBeHidden();
      await expect(thread).toBeVisible();
      await page.unroute("**/navigation/resolve");
    }
    await thread.getByTestId("thread-side-column-resizer").focus();
    await page.keyboard.press("ArrowLeft");
    const roomScroll = await channel
      .locator(".messages")
      .first()
      .evaluate((el) => el.scrollTop);
    const originalWidth = (await thread.boundingBox()).width;
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="动态"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(channel).toBeHidden();
    await expect(thread).toBeVisible();
    assert.ok(
      Math.abs((await profile.boundingBox()).width - originalWidth) < 1,
      "replacement keeps right slot width",
    );
    assert.ok((await thread.boundingBox()).x < (await profile.boundingBox()).x);
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/rah-two-pages-${engine.name()}-${kind}-thread-profile.png`,
    });
    await profile
      .getByRole("button", { name: "关闭 Agent 侧栏", exact: true })
      .click();
    await expect(channel).toBeVisible();
    await expect(thread).toBeVisible();
    await expect(composer).toHaveValue("Room draft retained");
    await expect(reply).toHaveValue("Thread draft retained");
    assert.ok(
      Math.abs(
        (await channel
          .locator(".messages")
          .first()
          .evaluate((el) => el.scrollTop)) - roomScroll,
      ) < 2,
      `Room scroll survives hidden source and restoration (${kind}: before=${roomScroll}, after=${await channel
        .locator(".messages")
        .first()
        .evaluate((el) => el.scrollTop)})`,
    );
    await agentAvatar.click();
    await expect(profile).toBeVisible();
    await expect(thread).toBeHidden();
    await expect(channel).toBeVisible();
    await profile.getByRole("tab", { name: "资料", exact: true }).click();
    await profile
      .getByRole("button", { name: "编辑显示名称", exact: true })
      .click();
    const profileDraft = profile.getByRole("textbox", {
      name: "显示名称",
      exact: true,
    });
    await profileDraft.fill("Unsaved fixture name");
    await agentMessage.hover();
    await agentMessage
      .getByRole("button", { name: "在消息列中回复", exact: true })
      .click();
    await expect(thread).toBeVisible();
    await expect(profile).toBeHidden();
    await expect(reply).toHaveValue("Thread draft retained");
    await thread.locator(".rah-thread-close").click();
    await expect(profile).toBeVisible();
    await expect(profileDraft).toHaveValue("Unsaved fixture name");
    await expect(
      profile.getByRole("tab", { name: "资料", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await profile.getByRole("button", { name: "取消", exact: true }).click();
    await agentMessage.hover();
    await agentMessage
      .getByRole("button", { name: "在消息列中回复", exact: true })
      .click();
    await expect(profile).toBeHidden();
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .last()
      .click();
    await expect(
      page.getByRole("main", { name: "Human 详情侧栏", exact: true }),
    ).toBeVisible();
    await expect(channel).toBeHidden();
    await expect(thread).toBeVisible();
    for (const width of [2560, 1200, 900, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect(profile).toBeVisible();
      await expect(channel).toBeHidden();
      if (width === 390) {
        assert.ok(
          Math.abs((await profile.boundingBox()).width - width) < 2,
          "mobile target fills viewport",
        );
      }
      if (width >= 1200) await expect(thread).toBeVisible();
      else await expect(thread).toBeHidden();
      const visible = await page
        .locator(".rah-product-shell > .channel, .rah-product-shell > .thread")
        .evaluateAll(
          (els) =>
            els.filter(
              (el) =>
                getComputedStyle(el).visibility === "visible" &&
                el.getBoundingClientRect().width > 0 &&
                el.getBoundingClientRect().height > 0,
            ).length,
        );
      assert.equal(visible, width >= 1200 ? 2 : 1);
      await page.screenshot({
        animations: "disabled",
        path: `/tmp/rah-two-pages-${engine.name()}-${kind}-${width}.png`,
      });
    }
    await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
    await expect(thread).toBeVisible();
    assert.ok(
      Math.abs((await thread.boundingBox()).width - 390) < 2,
      "restored mobile Thread fills viewport",
    );
    await expect(reply).toHaveValue("Thread draft retained");
    await thread.locator(".rah-thread-back").click();
    await expect(channel).toBeVisible();
    await expect(composer).toHaveValue("Room draft retained");
    await channel
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(channel).toBeHidden();
    await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
    await expect(channel).toBeVisible();
    await page.reload();
    await expect(channel).toBeVisible();
  }
  const taskHead = await post("rooms/sync", {
    roomId: f.roomId,
    consumerId: "two-pages-task",
    bootstrap: "latest",
  });
  await post("tasks/create", {
    roomId: f.roomId,
    title: "Isolated two-page Task fixture",
    dependencyTaskIds: [],
    collaboratorIds: [],
    reviewerIds: [],
    basedOnRoomSeq: taskHead.latestRoomSeq,
    idempotencyKey: crypto.randomUUID(),
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(f.origin + "/?room=" + f.roomId);
  const taskRoom = page.locator(
    ".rah-product-shell > .channel:not(.rah-agent-peek)",
  );
  await taskRoom.getByRole("tab", { name: "任务", exact: true }).click();
  await taskRoom.locator(".rah-global-card-open").first().click();
  const taskThread = page.getByTestId("thread-side-column");
  await expect(taskThread).toBeVisible();
  await taskThread.locator(".rah-message-avatar-trigger").first().click();
  await expect(page.locator(".rah-agent-peek")).toBeVisible();
  await expect(taskRoom).toBeHidden();
  await expect(taskThread).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: `/tmp/rah-two-pages-${engine.name()}-room-task-person.png`,
  });
  await page
    .locator(".rah-agent-peek")
    .getByRole("button", { name: /关闭.*侧栏/ })
    .click();
  await expect(taskRoom).toBeVisible();
  await expect(
    taskRoom.getByRole("tab", { name: "任务", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await taskThread.locator(".rah-thread-close").click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(f.origin + "/?surface=tasks");
    await page.locator(".rah-global-card-open").first().click();
    const modal = page.getByTestId("task-thread-modal");
    await expect(modal).toBeVisible();
    assert.notEqual(
      await page
        .locator(".rah-task-detail-layer .rah-dialog-backdrop")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    await page.screenshot({
      animations: "disabled",
      path: `/tmp/rah-two-pages-${engine.name()}-task-modal-${width}.png`,
    });
    await modal
      .getByRole("button", { name: "关闭任务详情", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
  }
  console.log(
    "Room/DM two-page origins, Agent/Human, wide/narrow, replacements, drafts and reload passed",
  );
} finally {
  await browser.close();
  await f.close();
}
