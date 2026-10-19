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

    assert.equal(await mention.evaluate((el) => el.tagName), "A");
    await mention.click();
    await page.getByTestId("profile-panel").waitFor();
    if (width === 390) {
      await page.getByRole("button", { name: "返回聊天", exact: true }).click();
    }
    await channel.click();
    await page.waitForURL((u) => u.searchParams.get("room") === room.roomId);
    assert.deepEqual(errors, []);
    out.push({ width, mention: true, channelNavigation: true });
    await context.close();
  }
  return out;
}
