import assert from "node:assert/strict";
export async function verifyPanelPolicy({
  browser,
  origin,
  client,
  channels,
  head,
}) {
  const room = channels[2];
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE layout policy",
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "panel-policy-root",
  });
  const root = (
    await client.request("message.list", { roomId: room.roomId, limit: 20 })
  ).messages.find((m) => m.body === "FIXTURE layout policy");
  await client.request("thread.create", {
    roomId: room.roomId,
    rootMessageId: root.messageId,
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "panel-policy-thread",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`${origin}/?room=${room.roomId}&thread=${root.messageId}`);
    await page.getByTestId("read-only-thread-panel").waitFor();
    const results = [];
    const measure = async (width, height) => {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const state = await page.evaluate(() => {
        const main = document.querySelector(".thread-main-column"),
          thread = document.querySelector(".thread-side-column");
        const container = main.closest(".thread-layout-container");
        return {
          available: container.getBoundingClientRect().width,
          main: getComputedStyle(main).display,
          thread: thread.getBoundingClientRect().width,
          position: getComputedStyle(thread).position,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      const split = (width > height || width >= 1280) && state.available >= 680;
      assert.equal(
        state.position,
        split ? "relative" : "absolute",
        JSON.stringify({ width, height, state }),
      );
      assert.equal(state.main !== "none", split);
      assert.equal(state.overflow, false);
      results.push({ width, height, ...state });
      return state;
    };
    const initial = await measure(1440, 600);
    assert.equal(Math.round(initial.thread), 400);
    const threshold = Math.round(1440 - initial.available + 680);
    for (const width of [threshold - 1, threshold, 767, 768, 1024])
      await measure(width, 600);
    await measure(1024, 1200);
    await measure(1280, 1400);
    return results;
  } finally {
    await context.close();
  }
}
