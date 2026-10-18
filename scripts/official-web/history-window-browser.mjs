import assert from "node:assert/strict";
export async function verifyHistoryWindow({
  browser,
  origin,
  client,
  channel,
  head,
}) {
  let seq = await head(channel.roomId);
  for (let i = 0; i < 600; i++) {
    const r = await client.request("message.post", {
      roomId: channel.roomId,
      body: `FIXTURE bounded history ${i}\n${"history ".repeat(16)}`,
      basedOnRoomSeq: seq,
      idempotencyKey: `window-${i}`,
      recipients: [],
    });
    seq = r.event.roomSeq;
  }
  const results = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(10000);
    const failures = [],
      samples = [];
    page.on("pageerror", (e) => failures.push(e.message));
    // SDK path is discovered by operation request below; intercept the canonical timeline endpoint.
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const scroller = page.getByTestId("loom-message-timeline");
    await scroller.locator("[data-timeline-message-id]").first().waitFor();
    const snapshot = () =>
      scroller.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll("[data-timeline-message-id]")];
        const anchor = rows.find(
          (x) => x.getBoundingClientRect().bottom > r.top + 2,
        );
        return {
          ids: rows.map((x) => x.getAttribute("data-timeline-message-id")),
          anchor: anchor?.getAttribute("data-timeline-message-id"),
          offset: anchor ? anchor.getBoundingClientRect().top - r.top : null,
        };
      });
    const timelineUrl = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((x) => x.name)
        .find((x) => x.includes("timeline")),
    );
    assert.ok(timelineUrl);
    let captured;
    await page.route(timelineUrl, async (route) => {
      const input = route.request().postDataJSON();
      const response = await route.fetch();
      if (input.beforeSeq || input.afterSeq) {
        await page.evaluate(
          () =>
            new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
        );
        captured = await snapshot();
      }
      await route.fulfill({ response });
    });
    for (let i = 0; i < 8; i++) {
      const previous = await snapshot();
      const response = page.waitForResponse(
        (r) =>
          r.url() === timelineUrl &&
          r.request().postDataJSON().beforeSeq &&
          r.ok(),
      );
      await scroller.hover();
      await page.mouse.wheel(0, -100000);
      await response;
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(
              '[data-testid="loom-message-timeline"] [data-timeline-message-id]',
            )
            ?.getAttribute("data-timeline-message-id") !== id,
        previous.ids[0],
      );
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const after = await snapshot();
      assert.ok(after.ids.length <= 300);
      if (captured?.anchor) {
        const offset = await scroller
          .locator(`[data-timeline-message-id="${captured.anchor}"]`)
          .evaluate(
            (el) =>
              el.getBoundingClientRect().top -
              el
                .closest('[data-testid="loom-message-timeline"]')
                .getBoundingClientRect().top,
          );
        assert.ok(
          Math.abs(offset - captured.offset) < 3,
          `anchor moved ${offset - captured.offset}px`,
        );
      }
      samples.push(after.ids.length);
    }
    const held = await snapshot();
    const latest = await head(channel.roomId);
    await client.request("message.post", {
      roomId: channel.roomId,
      body: `FIXTURE live while reading ${width}`,
      basedOnRoomSeq: latest,
      idempotencyKey: `while-reading-${width}`,
      recipients: [],
    });
    await page.waitForTimeout(3300);
    assert.deepEqual((await snapshot()).ids, held.ids);
    const newer = page.waitForResponse(
      (r) =>
        r.url() === timelineUrl &&
        r.request().postDataJSON().afterSeq &&
        r.ok(),
    );
    await scroller.hover();
    await page.mouse.wheel(0, 100000);
    await newer;
    await page.waitForFunction(
      (id) =>
        [
          ...document.querySelectorAll(
            '[data-testid="loom-message-timeline"] [data-timeline-message-id]',
          ),
        ]
          .at(-1)
          ?.getAttribute("data-timeline-message-id") !== id,
      held.ids.at(-1),
    );
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
    assert.ok((await snapshot()).ids.length <= 300);
    assert.ok(captured?.anchor);
    const forwardOffset = await scroller
      .locator(`[data-timeline-message-id="${captured.anchor}"]`)
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el
            .closest('[data-testid="loom-message-timeline"]')
            .getBoundingClientRect().top,
      );
    assert.ok(
      Math.abs(forwardOffset - captured.offset) < 3,
      `forward anchor moved ${forwardOffset - captured.offset}px`,
    );
    assert.deepEqual(failures, []);
    results.push({
      width,
      samples,
      backgroundPreserved: true,
      forwardPaging: true,
      anchorWithin3px: true,
    });
    await page.close();
  }
  return results;
}
