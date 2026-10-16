import assert from "node:assert/strict";
export async function verifySearchEntities({
  browser,
  origin,
  client,
  workspace,
  channels,
  instances,
  head,
}) {
  for (const i of instances)
    await client.request("agent.manage", {
      action: "set_state",
      agentId: i.agentId,
      state: "disabled",
      basedOnRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: `search-disable-${i.instanceId}`,
    });
  const { agents } = await client.request("agent.list", {
    controlRoomId: workspace.controlRoomId,
  });
  const name = agents.find((a) => a.definition.agentId === instances[0].agentId)
    .currentRevision.displayName;
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        origin +
          "/?view=search&q=" +
          encodeURIComponent("#" + channels[0].name),
      );
      const entity = page.getByTestId(
        `search-channel-result-${channels[0].roomId}`,
      );
      await entity.waitFor({ timeout: 5000 });
      await entity.click();
      await page.waitForURL(
        (u) => u.searchParams.get("room") === channels[0].roomId,
      );
      assert.equal(
        new URL(page.url()).searchParams.get("view"),
        width === 1440 ? "search" : null,
      );
      await page.getByTestId("composer-textarea").waitFor();
      if (width === 1440) {
        await page.goto(origin + "/?room=" + channels[1].roomId);
        await page.getByTestId("app-top-bar-search").click();
        const input = page.getByRole("textbox", { name: "搜索内容" });
        await input.fill("#" + channels[0].name);
        await entity.waitFor();
        const exactBox = await entity.boundingBox(),
          allBox = await page
            .getByTestId("search-view-all-results")
            .boundingBox();
        assert.equal(
          allBox.y - exactBox.y - exactBox.height,
          8,
          "Native overlay head uses gap-2 between exact destination and all results",
        );
        await input.press("Enter");
        await page.waitForURL(
          (u) =>
            u.searchParams.get("room") === channels[0].roomId &&
            !u.searchParams.has("view"),
        );
        await page
          .getByTestId("desktop-search-overlay")
          .waitFor({ state: "hidden" });
        assert.equal(
          await page.getByTestId("desktop-search-overlay").count(),
          0,
        );
        await page.getByTestId("app-top-bar-search").click();
        await input.fill("FIXTURE");
        await page.getByTestId("search-entity-results").waitFor();
        assert.equal(
          await page
            .getByTestId("search-view-all-results")
            .getAttribute("data-selected"),
          "true",
        );
        await input.press("Enter");
        await page.waitForURL(
          (u) => u.searchParams.get("presentation") === "page",
        );
      }
      if (width === 1440) {
        const candidates = await page
          .locator("[data-entity-id]")
          .evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute("data-entity-id")),
          );
        const chosen = channels.find(
          (c) =>
            "channel:" + c.roomId !== candidates[0] &&
            candidates.includes("channel:" + c.roomId),
        );
        assert.ok(chosen);
        await page.goto(
          origin + "/?view=search&q=FIXTURE&room=" + chosen.roomId,
        );
        await page
          .getByTestId(`search-channel-result-${chosen.roomId}`)
          .waitFor();
        await page.waitForFunction(
          (id) =>
            document
              .querySelector(`[data-testid="search-channel-result-${id}"]`)
              ?.getAttribute("data-active") === "true",
          chosen.roomId,
          { timeout: 3000 },
        );
      }
      await page.goto(
        origin + "/?view=search&q=" + encodeURIComponent("@" + name),
      );
      const agent = page.locator(
        `[data-entity-id="agent:${instances[0].instanceId}"]`,
      );
      await agent.waitFor();
      const opens = [];
      let loseReply = width === 1440;
      const loseFirst = async (route) => {
        opens.push(route.request().postDataJSON());
        if (loseReply) {
          loseReply = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      };
      if (width === 1440)
        await page.route("**/v3/client/rooms/direct/open", loseFirst);
      await agent.click();
      if (width === 1440) {
        await page
          .getByRole("button", { name: "核实打开私聊", exact: true })
          .waitFor();
        assert.equal(new URL(page.url()).searchParams.has("room"), false);
        assert.equal(
          opens.length,
          1,
          "unknown direct-open must not silently resend",
        );
        await page
          .getByRole("button", { name: "核实打开私聊", exact: true })
          .click();
      }
      await page.waitForURL((u) => u.searchParams.has("room"));
      if (width === 1440) {
        assert.equal(opens.length, 2);
        assert.deepEqual(opens[0], opens[1]);
        await page.unroute("**/v3/client/rooms/direct/open", loseFirst);
      }
      const { rooms } = await client.request("room.list", {
        workspaceId: workspace.workspaceId,
      });
      const box = rooms.find(
        (r) => r.roomId === new URL(page.url()).searchParams.get("room"),
      );
      assert.equal(box.instancePrivateBox.instanceId, instances[0].instanceId);
      assert.equal(
        new URL(page.url()).searchParams.get("view"),
        width === 1440 ? "search" : null,
      );
      await page.getByTestId("composer-textarea").waitFor();
      await page.reload();
      await page.getByTestId("composer-textarea").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/loom-search-entities-${width}.png` });
      results.push({
        width,
        channelCandidate: true,
        privateBoxCandidate: true,
        exactOverlay: width === 1440,
        partialOverlay: width === 1440,
        refresh: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
