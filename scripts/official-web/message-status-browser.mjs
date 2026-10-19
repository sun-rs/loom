import assert from "node:assert/strict";
export async function verifyMessageStatus({
  browser,
  origin,
  client,
  channels,
  instances,
  head,
}) {
  const room = channels[2],
    instance = instances[0];
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE message state and mobile typography",
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "message-state-fixture",
  });
  const results = [];
  for (const width of [390, 1440]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      let state = "working";
      await page.route("**/v3/client/rooms/timeline", async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        for (const i of data.items ?? [])
          if (i.kind === "message") i.message.actorId = instance.instanceId;
        await route.fulfill({ response, json: data });
      });
      await page.route(
        "**/v3/client/rooms/agents/activity/list",
        async (route) => {
          if (state === "unknown")
            return route.fulfill({
              status: 503,
              body: "FIXTURE observation failure",
            });
          const response = await route.fetch(),
            data = await response.json();
          for (const a of data.agents)
            if (a.participantId === instance.instanceId)
              a.state = state === "left" ? "working" : state;
          await route.fulfill({ response, json: data });
        },
      );
      await page.route("**/v3/client/rooms/members/list", async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        if (state === "left")
          data.memberships = data.memberships.filter(
            (m) => m.principalId !== instance.instanceId,
          );
        await route.fulfill({ response, json: data });
      });
      await page.goto(`${origin}/?room=${room.roomId}`);
      const dot = page.getByTestId("message-instance-status").first();
      for (const next of ["working", "idle", "waking", "error"]) {
        state = next;
        await page.waitForFunction(
          (s) =>
            document
              .querySelector('[data-testid="message-instance-status"]')
              ?.getAttribute("data-state") === s,
          next,
        );
      }
      assert.equal(
        await dot.evaluate((el) => getComputedStyle(el).borderRadius),
        "2px",
      );
      state = "left";
      await page.getByText("已离开", { exact: true }).first().waitFor();
      assert.equal(await dot.count(), 0);
      state = "unknown";
      await page
        .getByText("已离开", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await dot.count(), 0);
      state = "idle";
      await dot.waitFor();
      const body = page
        .locator("[data-message-font-size]")
        .filter({ hasText: "FIXTURE message state" })
        .first();
      assert.equal(
        await body.evaluate((e) => getComputedStyle(e).fontSize),
        width === 390 ? "14px" : "16px",
      );
      assert.equal(
        await page.evaluate(() =>
          localStorage.getItem("slock_message_body_font_size"),
        ),
        null,
      );
      await page.screenshot({ path: `/tmp/loom-message-status-${width}.png` });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({
        width,
        activityStates: true,
        leftNotDeleted: true,
        failureClears: true,
        mobileDefault: true,
      });
    } finally {
      await ctx.close();
    }
  }
  return results;
}
