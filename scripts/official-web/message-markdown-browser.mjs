import assert from "node:assert/strict";
export async function verifyMessageMarkdown({
  browser,
  origin,
  client,
  channel,
  head,
}) {
  const literal = "> quoted\nplain **bold ** \\n #" + channel.slug;
  const body = [
    "FIXTURE markdown tree",
    "~~~text\n" + literal + "\n~~~",
    "`**inline ** \\n`",
    '<img src=x onerror="window.__loomXss=1">',
    "<script>window.__loomXss=2</script>",
    "[unsafe](javascript:alert(1))",
    "- [x] checked",
    "- [ ] unchecked",
    "\\#" + channel.slug,
  ].join("\n\n");
  await client.request("message.post", {
    roomId: channel.roomId,
    body,
    recipients: [],
    basedOnRoomSeq: await head(channel.roomId),
    idempotencyKey: "markdown-tree-fixture",
  });
  const msg = (
    await client.request("message.list", { roomId: channel.roomId, limit: 50 })
  ).messages.find((m) => m.body === body);
  assert.ok(msg);
  const results = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const row = page.locator(`[data-timeline-message-id="${msg.messageId}"]`);
    await row.waitFor();
    assert.equal(
      (await row.locator("pre code").innerText()).trimEnd(),
      literal,
      "tilde-fenced code must remain literal, including quotes, mentions and backslash-n",
    );
    assert.equal(
      await row.locator("code").filter({ hasText: "**inline **" }).innerText(),
      "**inline ** \\n",
    );
    assert.equal(
      await row
        .getByRole("link", { name: "#" + channel.slug, exact: true })
        .count(),
      0,
      "escaped and fenced channel references stay literal",
    );
    assert.ok(
      (await row.innerText()).includes(
        '<img src=x onerror="window.__loomXss=1">',
      ),
    );
    assert.equal(
      await row.locator('script,img[src="x"],a[href^="javascript:"]').count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.__loomXss), undefined);
    assert.equal(await row.locator("input[type=checkbox]:checked").count(), 1);
    assert.deepEqual(errors, []);
    results.push({
      width,
      tildeCodeUnchanged: true,
      rawHtmlText: true,
      noExecutableMarkup: true,
      checkedList: true,
    });
    await page.close();
  }
  return results;
}
