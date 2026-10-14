import assert from "node:assert/strict";
export async function verifyChatBootstrap(page, origin, roomId) {
  let release, reached;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = new Promise((resolve) => {
    reached = resolve;
  });
  await page.route("**/v3/client/sidebar/get", async (route) => {
    reached();
    await gate;
    await route.continue();
  });
  try {
    await page.goto(`${origin}/?room=${roomId}`);
    await pending;
    const screen = page.getByTestId("loom-bootstrap-loading");
    await screen.waitFor();
    const box = await screen.boundingBox();
    assert.equal(box.width, page.viewportSize().width);
    assert.equal(box.height, page.viewportSize().height);
    assert.equal(
      await page.getByText("正在读取列表设置…", { exact: true }).count(),
      0,
    );
    release();
    await screen.waitFor({ state: "hidden" });
  } finally {
    release();
    await page.unroute("**/v3/client/sidebar/get");
  }
  const timeline = page.getByTestId("loom-message-timeline");
  const rows = timeline.locator("[data-timeline-message-id]");
  await rows.nth(1).waitFor();
  const row = rows.nth(1).locator("[data-message-item]");
  const outer = await rows.nth(1).boundingBox(),
    inner = await row.boundingBox();
  assert.equal(Math.round(inner.x - outer.x), 12);
  assert.equal(Math.round(outer.width - inner.width), 24);
  assert.equal(await row.getAttribute("data-compact"), "true");
  await row.hover();
  assert.equal(
    Math.round((await row.boundingBox()).width),
    Math.round(inner.width),
  );
}
