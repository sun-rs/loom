import assert from "node:assert/strict";
export async function verifyChannelSettings({
  browser,
  origin,
  client,
  channels,
}) {
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const channel = channels[viewport.width === 1440 ? 0 : 1];
    await page.goto(`${origin}/?room=${channel.roomId}`);
    await page.getByTestId("loom-channel-control-trigger").click();
    const sheet = page.getByTestId("loom-channel-control-sheet");
    const name = sheet.getByRole("textbox", { name: "名称", exact: false });
    await name.waitFor();
    await name.fill("FIXTURE unsaved");
    await sheet.getByRole("button", { name: "取消", exact: true }).click();
    const discard = page.getByRole("alertdialog");
    await discard.waitFor();
    await discard.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(await name.inputValue(), "FIXTURE unsaved");
    await sheet.getByRole("button", { name: "取消", exact: true }).click();
    await discard.getByRole("button", { name: "放弃修改" }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.getByTestId("loom-channel-control-trigger").click();
    await name.waitFor();
    assert.equal(await name.inputValue(), channel.name);
    await name.fill(`FIXTURE renamed ${viewport.width}`);
    await sheet
      .getByRole("textbox", { name: "描述", exact: false })
      .fill("FIXTURE description");
    let original;
    await page.route("**/v3/client/rooms/update", async (route) => {
      original = route.request().postDataJSON();
      await route.fetch();
      await route.abort();
    });
    await sheet.getByRole("button", { name: "保存更改", exact: true }).click();
    await sheet.getByRole("button", { name: "核实操作结果" }).waitFor();
    await page.keyboard.press("Escape");
    assert.ok(await sheet.isVisible());
    await page.unroute("**/v3/client/rooms/update");
    const replay = page.waitForRequest((r) =>
      r.url().endsWith("/rooms/update"),
    );
    await sheet.getByRole("button", { name: "核实操作结果" }).click();
    assert.deepEqual((await replay).postDataJSON(), original);
    await sheet.waitFor({ state: "hidden" });
    await page.getByTestId("loom-channel-control-trigger").click();
    await name.waitFor();
    assert.equal(await name.inputValue(), `FIXTURE renamed ${viewport.width}`);
    const mute = sheet.getByRole("switch", { name: "静音动态" });
    await mute.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-label="静音动态"]')
          ?.getAttribute("aria-checked") === "true",
    );
    const prefs = await client.request("sidebar.get", {
      workspaceId: channel.workspaceId,
    });
    assert.ok(
      prefs.preferences.mutedActivity.includes(`room:${channel.roomId}`),
    );
    // Advance room state externally. The open form must not silently refresh its captured write basis.
    const sync = await client.request("room.sync", {
      roomId: channel.roomId,
      consumerId: "settings-conflict",
    });
    await client.request("room.update", {
      roomId: channel.roomId,
      basedOnRoomSeq: sync.latestRoomSeq,
      name: `EXTERNAL ${viewport.width}`,
      description: "external",
      visibility: "private",
      idempotencyKey: `settings-external-${viewport.width}`,
    });
    await name.fill("FIXTURE stale draft");
    await sheet.getByRole("button", { name: "保存更改", exact: true }).click();
    await sheet
      .getByText(
        "资料未保存，频道可能已变化。你的草稿已保留；重新读取后再修改。",
      )
      .waitFor();
    assert.equal(await name.inputValue(), "FIXTURE stale draft");
    await sheet.getByRole("button", { name: "重新读取频道资料" }).click();
    await page.waitForFunction(() =>
      document
        .querySelector("#channel-settings-name")
        ?.value.startsWith("EXTERNAL"),
    );
    await sheet.getByRole("button", { name: "归档频道", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({
      has: page.getByRole("button", { name: "确认归档", exact: true }),
    });
    await dialog.getByRole("button", { name: "确认归档" }).click();
    await sheet.waitFor({ state: "hidden" });
    await page.reload();
    await page.getByTestId("loom-channel-control-trigger").click();
    await sheet.getByRole("button", { name: "恢复频道", exact: true }).click();
    await sheet.waitFor({ state: "hidden" });
    const after = await client.request("room.sync", {
      roomId: channel.roomId,
      consumerId: "settings-after",
    });
    assert.ok(after.snapshot?.room);
    assert.ok(!after.snapshot.room.archivedAt);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      metadata: true,
      unknownExactReplay: true,
      conflictPreservesDraft: true,
      discardConfirmation: true,
      mute: true,
      archiveRestore: true,
    });
    await context.close();
  }
  return { fixture: true, results };
}
