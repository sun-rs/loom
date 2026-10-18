import assert from "node:assert/strict";
export async function verifyLoading({ browser, origin, channel }) {
  const results = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } }),
      errors = [],
      urls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => urls.push(r.url()));
    await page.goto(`${origin}/?room=${channel.roomId}`);
    await page.getByTestId("composer-textarea").waitFor();
    const initial = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((r) => ({ url: r.name, bytes: r.encodedBodySize })),
    );
    assert.equal(
      urls.some((u) =>
        /(SettingsPage|AgentPage|TasksPage|MemoryPage|DiscoveryPage|SavedPanel)-/.test(
          u,
        ),
      ),
      false,
    );
    for (const [view, chunk, selector] of [
      ["settings", "SettingsPage", '[data-testid="settings-sidebar-list"]'],
      ["agents", "AgentPage", "[data-role-id]"],
      ["tasks", "TasksPage", '[data-testid="tasks-create-button"]'],
    ]) {
      const loaded = page.waitForResponse(
        (r) => r.url().includes(`/${chunk}-`) && r.ok(),
        { timeout: 10000 },
      );
      await page.goto(`${origin}/?view=${view}`);
      await loaded;
      if (view === "tasks")
        await page
          .getByRole("heading", { name: "任务", exact: true })
          .waitFor();
      else await page.locator(selector).first().waitFor();
    }
    assert.deepEqual(errors, []);
    results.push({
      width,
      initialEncodedBytes: initial.reduce((n, r) => n + r.bytes, 0),
      initialResourceCount: initial.length,
      unopenedPanelsAbsent: true,
      settingsAgentsTasksOpened: true,
    });
    await page.close();
  }
  return results;
}
