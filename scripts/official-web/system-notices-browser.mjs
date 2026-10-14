import assert from "node:assert/strict";
export async function verifySystemNotices({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const { room } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    name: "FIXTURE system notices",
    slug: "fixture-system-notices",
    kind: "channel",
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "fixture-notices",
  });
  for (let n = 0; n < 2; n++) {
    await client.request("room.archive", {
      roomId: room.roomId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `notices-archive-${n}`,
    });
    await client.request("room.unarchive", {
      roomId: room.roomId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `notices-restore-${n}`,
    });
  }
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const mutations = [];
    page.on("request", (r) => {
      if (/activity\/mark|messages\/post/.test(r.url()))
        mutations.push(r.url());
    });
    await page.goto(`${origin}/?room=${room.roomId}`);
    await page.getByTestId("composer-textarea").waitFor();
    assert.equal(
      await page.getByText("频道还没有消息", { exact: true }).isVisible(),
      false,
      "unread durable notices must not render as an empty channel",
    );
    const toggle = page.getByTestId("system-message-group-toggle");
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.click();
    await page.getByTestId("system-message-group-details").waitFor();
    assert.equal(
      await page.getByText("频道已恢复", { exact: true }).count(),
      2,
    );
    const timeline = await client.request("room.timeline", {
      roomId: room.roomId,
      limit: 50,
    });
    for (const item of timeline.items) {
      assert.equal(item.kind, "notice");
      const row = page.locator(`[id="message-event:${item.notice.eventId}"]`);
      await row.waitFor();
      assert.equal(await row.getAttribute("data-slot"), "system-message-item");
    }
    await page.screenshot({
      path: `/tmp/loom-system-notices-${viewport.width}.png`,
      animations: "disabled",
    });
    await page.reload();
    await page.getByTestId("system-message-group-toggle").click();
    assert.equal(
      await page.getByText("频道已恢复", { exact: true }).count(),
      2,
    );
    assert.deepEqual(
      mutations,
      [],
      "timeline reading never marks read or posts messages",
    );
    results.push({
      viewport,
      persistentNotices: true,
      officialDisclosure: true,
      noReadMutation: true,
    });
    await context.close();
  }
  return results;
}
