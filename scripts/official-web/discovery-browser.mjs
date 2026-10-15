import { chooseOption } from "./select-browser.mjs";
import { verifyDiscoveryFaults } from "./discovery-faults.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// FIXTURE ONLY: read-only discovery against temporary real Core; no provider execution.
import assert from "node:assert/strict";
export async function verifyDiscovery({
  browser,
  origin,
  client,
  workspace,
  channel,
}) {
  const basis = await client.request("room.sync", {
    roomId: workspace.controlRoomId,
    consumerId: "discovery-layout-fixture",
  });
  const { room: longRoom } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    basedOnControlRoomSeq: basis.latestRoomSeq,
    idempotencyKey: "discovery-long-room",
    kind: "channel",
    name: "FIXTURE " + "LongChannelName".repeat(9),
    slug: "discovery-long-room",
  });
  const roomBasis = await client.request("room.sync", {
    roomId: longRoom.roomId,
    consumerId: "discovery-layout-fixture",
  });
  await client.request("message.post", {
    roomId: longRoom.roomId,
    body: "DISCOVERY_LAYOUT_ONLY",
    basedOnRoomSeq: roomBasis.latestRoomSeq,
    idempotencyKey: "discovery-long-message",
    recipients: [],
  });
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    const marks = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/activity/mark")) marks.push(request.url());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`${origin}/?view=search&room=${channel.roomId}`);
    await page.getByLabel("搜索内容", { exact: true }).fill("history");
    await page.getByRole("button", { name: "搜索消息", exact: true }).click();
    const expected = await client.request("search", {
      workspaceId: workspace.workspaceId,
      query: "history",
      scope: "all",
      sort: "recent",
      limit: 20,
    });
    await page
      .getByTestId("discovery-results")
      .locator("[data-result-id]")
      .first()
      .waitFor();
    assert.ok(
      (await page
        .locator('[data-result-id] [data-slot="search-message-result-header"]')
        .count()) > 0,
    );
    assert.deepEqual(
      await page
        .locator("[data-result-id]")
        .evaluateAll((rows) =>
          rows.map((r) => r.getAttribute("data-result-id")),
        ),
      expected.hits.map((h) => h.message.messageId),
    );
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    const second = await client.request("search", {
      workspaceId: workspace.workspaceId,
      query: "history",
      scope: "all",
      sort: "recent",
      limit: 20,
      cursor: expected.nextCursor,
    });
    await page
      .locator(`[data-result-id="${second.hits[0].message.messageId}"]`)
      .waitFor();
    assert.equal(
      await page.locator("[data-result-id]").count(),
      second.hits.length,
    );
    await page.locator("[data-result-id]").first().click();
    const dialog = page.getByRole("dialog");
    await dialog
      .locator(
        `[data-context-message-id="${second.hits[0].message.messageId}"]`,
      )
      .waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "搜索消息", exact: true }).click();
    await page
      .locator(`[data-result-id="${expected.hits[0].message.messageId}"]`)
      .waitFor();
    await page.reload();
    await page.locator("[data-result-id]").first().waitFor();
    assert.equal(
      await page.getByLabel("搜索内容", { exact: true }).inputValue(),
      "history",
    );
    await chooseOption(page, page, "搜索范围", "私聊");
    await page.getByText("没有匹配结果", { exact: true }).waitFor();
    await chooseOption(page, page, "搜索范围", "全部对话");
    await page
      .locator(`[data-result-id="${expected.hits[0].message.messageId}"]`)
      .waitFor();
    await page
      .getByLabel("搜索内容", { exact: true })
      .fill("no-such-FIXTURE-needle");
    await page.getByRole("button", { name: "搜索消息", exact: true }).click();
    await page.getByText("没有匹配结果", { exact: true }).waitFor();
    await verifyDiscoveryFaults(page, channel);
    await page.screenshot({
      path: join(tmpdir(), `loom-discovery-search-${viewport.width}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "动态", exact: true })
      .click();
    await page.getByRole("heading", { name: "动态", exact: true }).waitFor();
    const activity = await client.request("activity.list", {
      workspaceId: workspace.workspaceId,
      filter: "all",
      limit: 20,
    });
    assert.ok(
      activity.items.length > 0,
      "fixture must exercise real activity rows",
    );
    {
      await page
        .locator(`[data-result-id="${activity.items[0].key}"]`)
        .waitFor();
      assert.deepEqual(
        await page
          .locator("[data-result-id]")
          .evaluateAll((rows) =>
            rows.map((r) => r.getAttribute("data-result-id")),
          ),
        activity.items.map((i) => i.key),
      );
    }
    assert.equal(
      await page.getByTestId("conversation-card-primary").count(),
      activity.items.length,
    );
    assert.equal(
      await page
        .locator("[data-result-id]")
        .evaluateAll((rows) =>
          rows.some((row) => row.scrollWidth > row.clientWidth + 1),
        ),
      false,
      "long titles must not create horizontal overflow inside result rows",
    );
    await page.screenshot({
      path: join(tmpdir(), `loom-discovery-activity-${viewport.width}.png`),
      animations: "disabled",
    });
    // The official card supports keyboard open; context remains bounded and read-only.
    const firstActivity = page.getByTestId("inbox-row").first();
    await firstActivity.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .locator(
        `[data-context-message-id="${activity.items[0].latestMessage.messageId}"]`,
      )
      .waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const toolbar = page.getByTestId("inbox-toolbar");
    assert.equal(Math.round((await toolbar.boundingBox()).height), 54);
    assert.equal(await toolbar.getByRole("combobox").count(), 0);
    await page.getByTestId("inbox-filter-mentions").click();
    await page.waitForURL((url) => url.searchParams.get("af") === "mentions");
    assert.equal(
      await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.getByRole("button", { name: "刷新动态", exact: true }).click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
    await page
      .getByLabel("筛选角色", { exact: true })
      .fill("no-such-FIXTURE-role");
    await page.getByText("没有匹配的角色", { exact: true }).waitFor();
    await page.getByLabel("筛选角色", { exact: true }).fill("FixtureTom");
    await page
      .getByRole("button", { name: "FixtureTom", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(marks, []);
    results.push({
      viewport,
      searchMatchesApi: true,
      boundedPagination: true,
      contextByExactMessage: true,
      queryReload: true,
      scopeFilter: true,
      contextToConversationAndBack: true,
      emptyResults: true,
      activityMatchesApi: true,
      nativeSegmentedToolbar54px: true,
      officialActivityCardAndKeyboard: true,
      officialSearchMessageRow: true,
      agentNameFilter: true,
      staleReadCannotReplaceNewQuery: true,
      readFailureClearsAndRecovers: true,
      contextDenialClearsAndRecovers: true,
      noImplicitReadMark: true,
    });
    await context.close();
  }
  return results;
}
