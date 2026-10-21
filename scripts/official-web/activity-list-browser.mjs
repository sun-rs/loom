import assert from "node:assert/strict";
export async function verifyActivityList({
  browser,
  origin,
  channels,
  client,
  head,
  workspace,
  instances,
}) {
  const results = [];
  for (const instance of instances)
    await client.request("agent.manage", {
      action: "set_state",
      agentId: instance.agentId,
      state: "disabled",
      basedOnRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: `activity-list-disable-${instance.agentId}`,
    });
  for (const width of [1440, 900, 390]) {
    await client.request("message.post", {
      roomId: channels[2].roomId,
      body: `FIXTURE activity list ${width}`,
      recipients: [],
      basedOnRoomSeq: await head(channels[2].roomId),
      idempotencyKey: `activity-list-${width}`,
    });
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?view=activity");
      const row = page.getByTestId("inbox-row").first();
      await row.waitFor();
      assert.equal(await row.getAttribute("data-layout"), "list");
      const geometry = await row.evaluate((e) => {
        const body = e.querySelector('[data-testid="conversation-card-body"]');
        const title = e.querySelector(
          '[data-testid="conversation-card-primary"]',
        );
        const r = e.getBoundingClientRect();
        return {
          height: r.height,
          titleSize: getComputedStyle(title).fontSize,
          titleLine: getComputedStyle(title).lineHeight,
          padding: getComputedStyle(e).paddingLeft,
          bodyWhiteSpace: getComputedStyle(body).whiteSpace,
          bodyClamp: getComputedStyle(body).webkitLineClamp,
          titleClamp: getComputedStyle(title).webkitLineClamp,
          titleWhiteSpace: getComputedStyle(title).whiteSpace,
          avatar: e
            .querySelector('[data-testid="conversation-card-avatar"]')
            .getBoundingClientRect().width,
          metadata: !!e.querySelector(
            '[data-testid="conversation-card-metadata"]',
          ),
        };
      });
      assert.ok(geometry.height <= 70, JSON.stringify(geometry));
      assert.equal(geometry.bodyClamp, "1");
      assert.equal(geometry.titleClamp, "1");

      assert.equal(geometry.avatar, width === 390 ? 32 : 36);
      if (width === 390) {
        assert.equal(geometry.titleSize, "14px");
        assert.equal(geometry.titleLine, "18px");
        assert.equal(geometry.padding, "12px");
      }
      assert.equal(geometry.metadata, false);
      const done = row.getByTestId("inbox-row-done");
      if (width === 390) {
        assert.equal(await done.isVisible(), true);
        assert.equal(
          await row
            .getByTestId("conversation-card-timestamp")
            .evaluate((e) => getComputedStyle(e).opacity),
          "1",
        );
      } else {
        await row.hover();
        await done.waitFor();
        assert.equal(
          await done.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return e.contains(
              document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
            );
          }),
          true,
        );
      }
      assert.equal(await row.getAttribute("data-slot"), "inbox-item");
      const open = row.getByTestId("inbox-row-open");
      await open.click({ button: "right" });
      await page.getByTestId("activity-context-menu").waitFor();
      await page.keyboard.press("Escape");
      if (width === 900) {
        await open.click();
        await page.waitForURL(
          (u) =>
            u.searchParams.get("view") === "activity" &&
            (u.searchParams.has("room") || u.searchParams.has("thread")),
        );
        await page.goto(origin + "/?view=activity");
        await row.waitFor();
      }
      const beforeDoneUrl = page.url();
      if (width !== 390) await row.hover();
      const doneId = await row.getAttribute("data-result-id");
      await done.click();
      await page
        .locator(`[data-result-id="${doneId}"]`)
        .waitFor({ state: "detached" });
      assert.equal(
        page.url(),
        beforeDoneUrl,
        "done must not open the conversation",
      );
      await page.screenshot({
        path: `/tmp/loom-native-activity-list-${width}.png`,
        animations: "disabled",
      });
      await page.goto(origin + "/?view=computers");
      if (width === 390) await page.getByTestId("computer-mobile-row").click();
      const instances = page.getByTestId("computer-instances");
      await instances.waitFor();
      const instance = instances.getByRole("button").first();
      await instance.waitFor();
      assert.equal(
        (await instance
          .locator("span")
          .filter({ hasText: "FixtureTom" })
          .count()) > 0,
        true,
      );
      await instance.click();
      await page.waitForURL(
        (u) =>
          u.searchParams.get("view") === "agents" &&
          !!u.searchParams.get("role"),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        fixture: true,
        geometry,
        touchDoneVisible: width === 390,
        computerInstanceNavigation: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
