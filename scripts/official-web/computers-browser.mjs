import assert from "node:assert/strict";
export async function verifyComputers({ browser, origin }) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    let mode = "fresh";
    await page.route("**/v1/local/runtimes/list", async (route) => {
      if (mode === "error")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "fixture unavailable" }),
        });
      const response = await route.fetch();
      const body = await response.json();
      body.computer = {
        displayName: "Fixture computer",
        hostname: "fixture-host",
        os: "fixture-os",
        status: "online",
        observedAt: new Date(mode === "stale" ? 0 : Date.now()).toISOString(),
        staleAfterMs: 30000,
      };
      await route.fulfill({ response, json: body });
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?view=settings`);
    if (viewport.width >= 768)
      await page.getByTestId("left-rail-tab-computers").click();
    else
      await page
        .getByTestId("settings-sidebar-list")
        .getByRole("button", { name: "计算机", exact: true })
        .click();
    const row = page.getByTestId(
      viewport.width >= 768 ? "computer-desktop-row" : "computer-mobile-row",
    );
    await row.click();
    await page.getByTestId("computer-detail").waitFor();
    const id = new URL(page.url()).searchParams.get("computer");
    assert.ok(id);
    await page.reload();
    await page.getByTestId("computer-detail").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("computer"), id);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    if (viewport.width < 768) {
      await page
        .getByRole("button", { name: "计算机列表", exact: true })
        .click();
      await row.waitFor();
      await page.getByRole("button", { name: "设置列表", exact: true }).click();
      await page.getByTestId("settings-sidebar-list").waitFor();
    }
    mode = "stale";
    await page.goto(
      `${origin}/?view=computers&computer=${encodeURIComponent(id)}`,
    );
    await page
      .getByTestId("machine-connection-status")
      .filter({ hasText: "状态未知" })
      .waitFor();
    mode = "error";
    await page.reload();
    await page.getByRole("alert").filter({ visible: true }).first().waitFor();
    assert.equal(
      await page.getByTestId("machine-connection-status").count(),
      0,
    );
    mode = "fresh";
    await page
      .getByRole("button", { name: "重试", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByTestId("machine-connection-status")
      .filter({ hasText: "在线" })
      .waitFor();
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      selectionReloadBack: "passed",
      horizontalOverflow: false,
    });
    await context.close();
  }
  return { fixture: true, computers: results };
}
