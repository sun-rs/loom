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
  let releaseTimeline;
  const timelineGate = new Promise((resolve) => {
    releaseTimeline = resolve;
  });
  await page.route("**/v3/client/rooms/timeline", async (route) => {
    await timelineGate;
    await route.continue();
  });
  await page.reload();
  const loading = page.getByRole("status", { name: "正在读取频道" });
  await loading.waitFor();
  assert.equal(await loading.innerText(), "加载中…");
  assert.equal(await loading.locator("svg").count(), 0);
  const placement = await loading.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      p = el.parentElement.getBoundingClientRect();
    return { top: r.top - p.top, width: r.width, parentWidth: p.width };
  });
  assert.equal(placement.top, 0);
  assert.equal(placement.width, placement.parentWidth);
  releaseTimeline();
  await loading.waitFor({ state: "hidden" });
  await page.unroute("**/v3/client/rooms/timeline");
  await page.route("**/v3/client/workspaces/list", (route) => route.abort());
  await page.reload();
  await page.getByTestId("loom-bootstrap-loading").waitFor({ state: "hidden" });
  assert.equal(
    await page.getByRole("alert").count(),
    1,
    "connection failure appears once in the visible column",
  );
  await page.unroute("**/v3/client/workspaces/list");
  await page.reload();
  await rows.nth(1).waitFor();
}
