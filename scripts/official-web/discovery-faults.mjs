import assert from "node:assert/strict";
export async function verifyDiscoveryFaults(page, channel) {
  let release, started, finished;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const ended = new Promise((resolve) => {
    finished = resolve;
  });
  await page.route("**/v3/client/search", async (route) => {
    if (route.request().postDataJSON().query !== "FIXTURE") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    started();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* The client aborted this superseded read. */
    } finally {
      finished();
    }
  });
  await page.getByLabel("搜索内容", { exact: true }).fill("FIXTURE");
  await page.getByLabel("搜索内容", { exact: true }).press("Enter");
  await began;
  await page
    .getByLabel("搜索内容", { exact: true })
    .fill("no-such-FIXTURE-later");
  await page.getByLabel("搜索内容", { exact: true }).press("Enter");
  await page
    .getByText("没有找到“no-such-FIXTURE-later”的结果", { exact: true })
    .waitFor();
  release();
  await ended;
  assert.equal(await page.locator("[data-result-id]").count(), 0);
  await page.unroute("**/v3/client/search");
  await page.route("**/v3/client/search", (route) => route.abort());
  await page.getByLabel("搜索内容", { exact: true }).fill("history");
  await page.getByLabel("搜索内容", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "重新读取", exact: true }).waitFor();
  assert.equal(await page.locator("[data-result-id]").count(), 0);
  await page.unroute("**/v3/client/search");
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.locator("[data-result-id]").first().waitFor();
  await page.route("**/v3/client/messages/context", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "forbidden", message: "FIXTURE denied" },
      }),
    }),
  );
  await page.locator("[data-result-id]").first().click();
  await page.getByText("无法打开消息，请刷新重试。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(new URL(page.url()).searchParams.has("message"), false);
  await page.unroute("**/v3/client/messages/context");
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  const row = page.locator("[data-result-id]").first();
  await row.dblclick();
  await page
    .getByRole("heading", { name: channel.name, exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("room"), channel.roomId);
  await page.goBack();
  await page.getByLabel("搜索内容", { exact: true }).waitFor();
  await page.locator("[data-result-id]").first().waitFor();
}
