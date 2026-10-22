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
    await sheet.getByTestId("channel-overflow-members-entry").click();
    const memberPage = sheet.getByTestId("member-page");
    assert.equal(
      await memberPage.evaluate(
        (el) => !!el.closest('[data-slot="drawer-content"]'),
      ),
      true,
      "members must occupy native drawer content, not popup sibling",
    );
    // The member portal and the root hiding effect commit separately. Wait for
    // the required geometry, rather than accepting a transient half-height frame.
    await page.waitForFunction(
      (height) => {
        const el = document.querySelector('[data-testid="member-page"]');
        return el && el.getBoundingClientRect().height > height * 0.9;
      },
      viewport.height,
      { timeout: 5000 },
    );
    assert.ok(
      (await memberPage.boundingBox()).height > viewport.height * 0.9,
      "member page fills drawer height",
    );
    await memberPage.getByTestId("member-page-search").fill("NO SUCH MEMBER");
    await memberPage.getByText(/NO SUCH MEMBER/).waitFor();
    await memberPage.getByTestId("member-page-search").fill("");
    const beforeMembers = Number(
      await memberPage.getByTestId("member-page-count").textContent(),
    );
    await memberPage.getByTestId("member-page-add").click();
    const candidates = memberPage.locator(
      '[data-testid^="add-candidate-agent-"]',
    );
    await candidates.first().waitFor();
    await candidates.first().click();
    await memberPage
      .getByTestId("add-member-confirm")
      .waitFor({ state: "visible" });
    assert.equal(
      await memberPage.getByTestId("add-member-confirm").isEnabled(),
      true,
    );
    await memberPage.getByTestId("add-member-create-agent-entry").click();
    await page
      .getByTestId("loom-create-role")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    const instantiateRequests = [];
    let lostAdd = false;
    await page.route("**/v3/client/roles/instantiate", async (route) => {
      instantiateRequests.push(route.request().postDataJSON());
      if (!lostAdd) {
        lostAdd = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await memberPage.getByTestId("add-member-confirm").click();
    await memberPage
      .getByRole("button", { name: "核实操作结果", exact: true })
      .waitFor();
    const addReplay = page.waitForResponse(
      (r) => r.url().endsWith("/roles/instantiate") && r.status() === 200,
    );
    await memberPage
      .getByRole("button", { name: "核实操作结果", exact: true })
      .click();
    await addReplay;
    await memberPage.getByTestId("add-member-confirm").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="add-member-confirm"]')
        ?.textContent?.includes("0"),
    );
    assert.equal(instantiateRequests.length, 2);
    assert.deepEqual(instantiateRequests[0], instantiateRequests[1]);
    await page.unroute("**/v3/client/roles/instantiate");
    await memberPage.getByTestId("add-member-back").click();
    await page.waitForFunction(
      (expected) =>
        Number(
          document.querySelector('[data-testid="member-page-count"]')
            ?.textContent,
        ) === expected,
      beforeMembers + 1,
    );
    assert.equal(
      Number(await memberPage.getByTestId("member-page-count").textContent()),
      beforeMembers + 1,
    );
    await memberPage
      .getByRole("button", { name: /^移除 / })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();

    await memberPage.getByTestId("member-page-back").click();
    assert.equal(
      await name.inputValue(),
      "FIXTURE unsaved",
      "member roundtrip preserves root draft",
    );

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
    const pin = sheet.getByTestId("channel-settings-pin-switch");
    await pin.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="channel-settings-pin-switch"]')
          ?.getAttribute("aria-checked") === "true",
    );
    assert.ok(
      (
        await client.request("sidebar.get", {
          workspaceId: channel.workspaceId,
        })
      ).preferences.pinned.includes(`room:${channel.roomId}`),
    );
    const mute = sheet.getByRole("switch", { name: "静音活动" });
    await mute.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="channel-overflow-mute-switch"]')
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
      sourceMemberPages: true,
      rootDraftPreserved: true,
      addedMemberAppearsWithoutReload: true,
      addLostResponseExactReplay: true,
      removeConfirmationCancelled: true,
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
