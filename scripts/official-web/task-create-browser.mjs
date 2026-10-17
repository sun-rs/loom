import assert from "node:assert/strict";
export async function verifyTaskCreate({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const room = (
      await client.request("room.create", {
        workspaceId: workspace.workspaceId,
        kind: "channel",
        name: `FIXTURE batch ${width}`,
        slug: `fixture-batch-${width}`,
        basedOnControlRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `batch-room-${width}`,
      })
    ).room;
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage(),
        errors = [],
        calls = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/v3/client/tasks/create", async (route) => {
        const payload = route.request().postDataJSON();
        calls.push(payload);
        if (payload.title.includes("reject")) {
          await route.fulfill({
            status: 403,
            json: {
              error: { code: "forbidden", message: "FIXTURE rejected title" },
            },
          });
        } else if (calls.length === 2) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await page.goto(origin + "/?view=agents&room=" + room.roomId);
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", {
          name: width === 390 ? "首页" : "频道",
          exact: true,
        })
        .click();
      if (width === 390)
        await page.locator(`[data-public-channel-id="${room.roomId}"]`).click();
      await page
        .getByTestId("chat-composer-shell")
        .locator("textarea")
        .fill("FIXTURE unsent draft");
      await page.getByTestId("panel-tab-tasks").click({ timeout: 3000 });
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const dialog = page.getByTestId("loom-create-tasks");
      await dialog.locator("input").nth(0).fill("FIXTURE discard");
      await page.mouse.click(2, 2);
      assert.equal(await dialog.isVisible(), true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      assert.equal(await dialog.locator("input").nth(0).inputValue(), "");
      await dialog.locator("input").nth(0).fill(`FIXTURE first ${width}`);
      await dialog
        .getByRole("button", { name: "再加一条", exact: true })
        .click();
      await dialog.locator("input").nth(1).fill(`FIXTURE second ${width}`);
      await dialog
        .getByRole("button", { name: "再加一条", exact: true })
        .click();
      await dialog.locator("input").nth(2).fill(`FIXTURE third ${width}`);
      await dialog.locator("button[type=submit]").click();
      await dialog
        .getByRole("button", { name: "核实创建结果", exact: true })
        .waitFor();
      assert.equal(
        calls.length,
        2,
        "Unknown second result pauses the third write",
      );
      const pendingUrl = page.url();
      // Real router history entry: synthetic pushState loses React Router's index.
      await page.goBack();
      await page.waitForURL(pendingUrl);
      await page.keyboard.press("Escape");
      await dialog.waitFor();
      await dialog
        .getByRole("button", { name: "核实创建结果", exact: true })
        .click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(calls.length, 4);
      const panel = page.getByTestId("loom-tasks-page");
      await panel
        .getByText(`FIXTURE first ${width}`, { exact: true })
        .waitFor();
      assert.equal(
        await panel.getByText(`#${room.name}`, { exact: true }).count(),
        0,
        "Native channel mode omits redundant channel labels",
      );
      assert.deepEqual(
        calls[1],
        calls[2],
        "Verification replays the exact second write",
      );
      assert.notEqual(calls[0].idempotencyKey, calls[3].idempotencyKey);
      const tasks = (
        await client.request("task.list", { roomId: room.roomId, limit: 50 })
      ).tasks;
      assert.equal(tasks.length, 3);
      assert.deepEqual(
        new Set(tasks.map((t) => t.title)),
        new Set(
          ["first", "second", "third"].map((s) => `FIXTURE ${s} ${width}`),
        ),
      );
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      await dialog.locator("input").fill(`FIXTURE accepted ${width}`);
      await dialog
        .getByRole("button", { name: "再加一条", exact: true })
        .click();
      await dialog.locator("input").nth(1).fill(`FIXTURE reject ${width}`);
      await dialog.locator("button[type=submit]").click();
      await dialog.getByText(/当前项未创建/).waitFor();
      assert.equal(await dialog.locator("input").count(), 1);
      assert.equal(
        await dialog.locator("input").inputValue(),
        `FIXTURE reject ${width}`,
      );
      assert.equal(
        (await client.request("task.list", { roomId: room.roomId, limit: 50 }))
          .tasks.length,
        4,
      );
      await dialog.locator("input").fill(`FIXTURE corrected ${width}`);
      await dialog.locator("button[type=submit]").click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        (await client.request("task.list", { roomId: room.roomId, limit: 50 }))
          .tasks.length,
        5,
      );
      await page.getByTestId("panel-tab-chat").click();
      await page.getByTestId("chat-composer-shell").waitFor();
      assert.equal(
        await page
          .getByTestId("chat-composer-shell")
          .locator("textarea")
          .inputValue(),
        "FIXTURE unsent draft",
      );
      await page.goto(origin + "/?view=tasks");
      await page.getByTestId("loom-tasks-page").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "新建任务", exact: true })
          .count(),
        0,
        "No implicit creation in the global page",
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        nativeChannelEntry: true,
        threeTitles: true,
        unknownPausesBatch: true,
        exactReplay: true,
        oneTaskPerTitle: true,
        globalEntryAbsent: true,
        partialRejectionKeepsOnlyUnfinishedTitles: true,
        unknownBlocksNavigation: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
