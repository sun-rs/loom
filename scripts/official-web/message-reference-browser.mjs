import assert from "node:assert/strict";
export async function verifyMessageReferences({
  browser,
  origin,
  client,
  workspace,
  channels,
  instanceNames,
  head,
}) {
  const { room } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "reference-target",
    kind: "channel",
    name: "Reference-target",
    slug: "reference-target",
  });
  await client.request("message.post", {
    roomId: channels[2].roomId,
    basedOnRoomSeq: await head(channels[2].roomId),
    idempotencyKey: "reference-body",
    body: `@${instanceNames[0]} #Reference-target FIXTURE reference`,
    recipients: [],
  });
  const { principal } = await client.request("principal.me", {});
  await client.request("principal.update", {
    displayName: "Sun",
    avatarKey: null,
  });
  await client.request("message.post", {
    roomId: channels[2].roomId,
    basedOnRoomSeq: await head(channels[2].roomId),
    idempotencyKey: "reference-self",
    body: `@${principal.handle} FIXTURE self mention`,
    recipients: [],
  });
  const root = (
    await client.request("message.list", {
      roomId: channels[2].roomId,
      limit: 50,
    })
  ).messages.find((m) => m.body.includes("FIXTURE self mention"));
  const { thread } = await client.request("thread.create", {
    roomId: channels[2].roomId,
    rootMessageId: root.messageId,
    basedOnRoomSeq: await head(channels[2].roomId),
    idempotencyKey: "identity-thread",
  });
  await client.request("thread.reply", {
    roomId: channels[2].roomId,
    threadId: thread.threadId,
    body: `@${principal.handle} FIXTURE thread identity`,
    basedOnRoomSeq: await head(channels[2].roomId),
    idempotencyKey: "identity-thread-reply",
  });
  const out = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?room=${channels[2].roomId}`);
    const timeline = page.getByTestId("loom-message-timeline");
    await timeline.waitFor();
    const channel = timeline.getByRole("link", {
      name: "#Reference-target",
      exact: true,
    });
    await channel.waitFor();
    const mention = timeline.getByText("@" + instanceNames[0], { exact: true });
    await mention.waitFor();

    const self = timeline.getByText("@Sun", { exact: true });
    await self.waitFor({ timeout: 5000 });
    assert.ok(
      (await self.getAttribute("class")).includes("bg-primary"),
      "self mention must use official yellow primary recipe",
    );
    assert.ok(
      (await channel.getAttribute("class")).includes("bg-accent-soft"),
      "channel references retain official pink accent",
    );
    assert.equal(await mention.evaluate((el) => el.tagName), "A");
    await mention.hover();
    const preview = page.getByTestId("loom-message-profile");
    await preview.waitFor();
    assert.equal(await preview.locator(".text-headline").count(), 1);
    assert.equal(await preview.locator(".text-mono-meta").count(), 1);
    assert.equal(await preview.locator(".border-t-2").count(), 0);
    await page.mouse.move(width - 2, 2);
    await preview.waitFor({ state: "hidden" });
    await mention.click();
    await page.getByTestId("profile-panel").waitFor();
    if (width === 390) {
      await page.getByRole("button", { name: "返回聊天", exact: true }).click();
    }
    await channel.click();
    await page.waitForURL((u) => u.searchParams.get("room") === room.roomId);
    await page.goto(
      `${origin}/?room=${channels[2].roomId}&thread=${root.messageId}`,
    );
    await page
      .getByText("FIXTURE thread identity", { exact: false })
      .last()
      .waitFor();
    const threadSelf = page
      .locator('[data-testid="read-only-thread-panel"]')
      .getByText("@Sun", { exact: true });
    assert.ok(
      (await threadSelf.count()) >= 1,
      "thread must use authorized current member display names",
    );
    assert.deepEqual(errors, []);
    out.push({ width, mention: true, channelNavigation: true });
    await context.close();
  }
  return out;
}
