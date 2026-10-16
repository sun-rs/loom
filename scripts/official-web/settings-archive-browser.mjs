import assert from "node:assert/strict";
export async function verifySettingsArchive({
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
        name: `FIXTURE archived ${width}`,
        slug: `fixture-archived-${width}`,
        basedOnControlRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `archive-create-${width}`,
      })
    ).room;
    await client.request("room.archive", {
      roomId: room.roomId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `archive-${width}`,
    });
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
      const url = origin + "/?view=settings&settings=server";
      await page.goto(url);
      const row = page.getByTestId(`archived-channel-row-${room.roomId}`);
      await row.waitFor({ timeout: 5000 });
      await row.locator("button").first().click();
      await page.waitForURL(
        (u) =>
          u.searchParams.get("room") === room.roomId &&
          !u.searchParams.has("view"),
      );
      await page.goBack();
      await row.waitFor();
      await page.route("**/v3/client/rooms/unarchive", (route) =>
        route.fulfill({
          status: 403,
          json: { error: { code: "forbidden", message: "FIXTURE denied" } },
        }),
      );
      const reread = page.waitForResponse((r) =>
        r.url().endsWith("/v3/client/rooms/list"),
      );
      await row.locator("button").last().click();
      await reread;
      await page
        .getByTestId("archived-channels-error")
        .waitFor({ timeout: 3000 });
      assert.equal(await row.locator("button").last().isEnabled(), true);
      await page.unroute("**/v3/client/rooms/unarchive");
      await page.route("**/v3/client/rooms/unarchive", async (route) => {
        calls.push(route.request().postDataJSON());
        if (calls.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await row.locator("button").last().click();
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .waitFor();
      assert.equal(calls.length, 1);
      assert.equal(await row.locator("button").last().isDisabled(), true);
      await page
        .getByRole("button", { name: "核实操作结果", exact: true })
        .click();
      await row.waitFor({ state: "detached" });
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      const rooms = (
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms;
      assert.equal(
        rooms.find((r) => r.roomId === room.roomId).archivedAt,
        undefined,
      );
      await page.reload();
      await page.getByTestId("loom-settings-detail").waitFor();
      assert.equal(await row.count(), 0);
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({
        width,
        open: true,
        unknownRetrySameKey: true,
        restored: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
