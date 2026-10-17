// Temporary authenticated Core, fake discovery; no paid execution.
import assert from "node:assert/strict";
export async function verifyTabOrder({
  browser,
  origin,
  client,
  workspace,
  channel,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const prefs = (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences;
    await client.request("sidebar.patch", {
      workspaceId: workspace.workspaceId,
      expectedVersion: prefs.version,
      idempotencyKey: `tab-seed-${width}`,
      patch: { channelPanelTabOrder: ["tasks", "chat"] },
    });
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const tabs = page.locator('[data-testid^="panel-tab-"]');
    await tabs.first().waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid^="panel-tab-"]')
          ?.getAttribute("data-testid") === "panel-tab-tasks",
    );
    assert.equal(
      await tabs.first().getAttribute("data-testid"),
      "panel-tab-tasks",
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid^="panel-tab-"]')
          ?.getAttribute("data-testid") === "panel-tab-tasks",
    );
    const writes = [];
    let lost = false;
    await page.route("**/v3/client/sidebar/patch", async (route) => {
      writes.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    const chat = page.getByTestId("panel-tab-chat"),
      tasks = page.getByTestId("panel-tab-tasks");
    const a = await chat.boundingBox(),
      b = await tasks.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 3, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    await page
      .getByRole("button", { name: "核实操作结果", exact: true })
      .click();
    await page
      .getByRole("button", { name: "核实操作结果", exact: true })
      .waitFor({ state: "hidden" });
    assert.deepEqual(writes[0], writes[1]);
    assert.deepEqual(
      (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences.channelPanelTabOrder,
      ["chat", "tasks"],
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid^="panel-tab-"]')
          ?.getAttribute("data-testid") === "panel-tab-chat",
    );
    results.push({
      width,
      persisted: true,
      drag: true,
      unknownExactReplay: true,
    });
    await context.close();
  }
  return results;
}
