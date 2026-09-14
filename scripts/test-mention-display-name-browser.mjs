import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const post = async (path, data) => {
    const response = await page.request.post(
      fixture.origin + "/v3/client/" + path,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const sync = (roomId) =>
    post("rooms/sync", {
      roomId,
      consumerId: "mention-name-fixture",
      bootstrap: "latest",
      limit: 50,
    });
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "Mention name fixture",
      slug: "mention-name-fixture",
      visibility: "private",
      basedOnControlRoomSeq: (await sync(workspace.controlRoomId))
        .latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  await page.goto(fixture.origin + "/?surface=agents");
  const profileRead = page.waitForResponse((r) =>
    r.url().endsWith("/humans/profile"),
  );
  await page.locator(".rah-agent-human-section button").click();
  const initial = (await (await profileRead).json()).principal;
  const body = `@${initial.handle} historical mention; code: \`@${initial.handle}\`; @unknown-person`;
  const posted = await post("messages/post", {
    roomId: room.roomId,
    body,
    recipients: [],
    basedOnRoomSeq: (await sync(room.roomId)).latestRoomSeq,
    idempotencyKey: crypto.randomUUID(),
  });
  const thread = (
    await post("threads/create", {
      roomId: room.roomId,
      rootMessageId: posted.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: (await sync(room.roomId)).latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  await post("threads/reply", {
    roomId: room.roomId,
    threadId: thread.threadId,
    body,
    recipientIds: [],
    basedOnRoomSeq: (await sync(room.roomId)).latestRoomSeq,
    idempotencyKey: crypto.randomUUID(),
  });
  const agents = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents;
  const peer = agents[0];
  const direct = (
    await post("rooms/direct/open", {
      workspaceId: workspace.workspaceId,
      peerPrincipalId: peer.definition.participantId,
      basedOnControlRoomSeq: (await sync(workspace.controlRoomId))
        .latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  const directPost = await post("messages/post", {
    roomId: direct.roomId,
    body: `@${initial.handle} DM historical mention`,
    recipients: [],
    basedOnRoomSeq: (await sync(direct.roomId)).latestRoomSeq,
    idempotencyKey: crypto.randomUUID(),
  });
  await post("messages/save", {
    roomId: room.roomId,
    messageId: posted.event.aggregateId,
    saved: true,
    idempotencyKey: crypto.randomUUID(),
  });
  const forwarded = await post("messages/forward", {
    sourceRoomId: room.roomId,
    sourceMessageIds: [posted.event.aggregateId],
    destinationRoomIds: [room.roomId],
    requestId: crypto.randomUUID(),
  });
  assert.equal(forwarded.results[0].status, "delivered");
  await page.route("**/v3/client/search", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.hits = data.hits
      .filter((hit) => hit.message.actorId === initial.principalId)
      .map((hit) =>
        hit.message.actorId === initial.principalId
          ? { ...hit, senderName: initial.handle }
          : hit,
      );
    await route.fulfill({ response, json: data });
  });
  await page.route("**/v3/client/messages/saved", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.items = data.items.map((row) =>
      row.sender.principalId === initial.principalId
        ? { ...row, sender: initial }
        : row,
    );
    await route.fulfill({ response, json: data });
  });
  await page.goto(fixture.origin + "/?room=" + room.roomId);
  const message = page.locator(
    `.msg[data-message-id="${posted.event.aggregateId}"]`,
  );
  const mention = message.locator(".rah-rich-self-reference");
  await expect(mention).toBeVisible();
  for (const name of ["Hakase", "Hakase 二号"]) {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "账户", exact: true }).click();
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill(name);
    const oldAvatar = (await page
      .locator(".rah-settings-profile-preview img")
      .count())
      ? await page
          .locator(".rah-settings-profile-preview img")
          .getAttribute("src")
      : null;
    const png = Buffer.from(
      name === "Hakase"
        ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg=="
        : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
      "base64",
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      page.locator(".rah-settings-profile-preview img"),
    ).not.toHaveAttribute("src", oldAvatar ?? "");
    const avatarSrc = await page
      .locator(".rah-settings-profile-preview img")
      .getAttribute("src");
    const saved = page.waitForResponse((r) =>
      r.url().endsWith("/principals/update"),
    );
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page
      .getByRole("button", { name: "聊天", exact: true })
      .first()
      .click();
    await expect(mention).toHaveText("@" + name);
    await expect(
      message.locator(".rah-message-avatar-trigger img").first(),
    ).toHaveAttribute("src", avatarSrc);
    await expect(
      message.locator(".thread-preview img").first(),
    ).toHaveAttribute("src", avatarSrc);
    await expect(message.locator(".msg-head b").first()).toHaveText(name);
    await expect(
      message.locator(".thread-preview .tp-line b").first(),
    ).toHaveText(name);
    await expect(message.locator("code")).toHaveText("@" + initial.handle);
    await expect(message).toContainText("@unknown-person");
    await mention.hover();
    await expect(page.locator(".rah-human-preview h2")).toHaveText(name);
    await expect(page.locator(".rah-human-preview")).toContainText("@" + name);
    await expect(
      page.locator(".rah-human-preview img").first(),
    ).toHaveAttribute("src", avatarSrc);
    await page.mouse.move(0, 0);
    await message.locator(".thread-preview").click();
    await expect(page.locator(".thread .msg-head b").first()).toHaveText(name);
    await expect(
      page.locator(".thread .rah-message-avatar-trigger img").last(),
    ).toHaveAttribute("src", avatarSrc);
    await expect(
      page.locator(".thread .rah-rich-self-reference").last(),
    ).toHaveText("@" + name);
    await page.locator(".thread .rah-thread-close").click();
    const forwardedCard = page.getByTestId("forwarded-bundle").first();
    await expect(forwardedCard.locator("article header b")).toHaveText(name);
    await expect(forwardedCard.locator("article img").first()).toHaveAttribute(
      "src",
      avatarSrc,
    );
    await page.getByRole("button", { name: "已保存", exact: true }).click();
    await expect(page.locator(".rah-saved-sender > span").last()).toHaveText(
      name,
    );
    await expect(page.locator(".rah-saved-sender img").first()).toHaveAttribute(
      "src",
      avatarSrc,
    );
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
      .fill("historical mention");
    await expect(
      page.locator(".rah-search-hit .result-title").first(),
    ).toHaveText(name);
    await expect(page.locator(".rah-search-hit img").first()).toHaveAttribute(
      "src",
      avatarSrc,
    );
    await page
      .getByRole("button", { name: "聊天", exact: true })
      .first()
      .click();
    await page
      .locator(".rah-direct-room-row")
      .filter({ hasText: peer.handle })
      .first()
      .click();
    const dm = page.locator(
      `.msg[data-message-id="${directPost.event.aggregateId}"]`,
    );
    await expect(dm.locator(".msg-head b")).toHaveText(name);
    await expect(dm.locator(".rah-message-avatar-trigger img")).toHaveAttribute(
      "src",
      avatarSrc,
    );
    await page.locator(".channel-row").filter({ hasText: room.name }).click();
    await page.screenshot({
      path: `/tmp/rah-mention-name-${engine.name()}-${name === "Hakase" ? "first" : "second"}.png`,
    });
  }
  await page.reload();
  await expect(mention).toHaveText("@Hakase 二号");
  const state = await post("messages/list", { roomId: room.roomId });
  assert.equal(
    state.messages.find((m) => m.messageId === posted.event.aggregateId).body,
    body,
    "rename never rewrites the durable message",
  );
  await page.goto(fixture.origin + "/?room=" + direct.roomId);
  const directMention = page.locator(
    `.msg[data-message-id="${directPost.event.aggregateId}"] .rah-rich-self-reference`,
  );
  await expect(directMention).toHaveText("@Hakase 二号");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(directMention).toHaveText("@Hakase 二号");
  assert.deepEqual(errors, []);
  console.log(
    engine.name(),
    "account rename twice, historical mention, tooltip identity, code exclusion and reload passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
