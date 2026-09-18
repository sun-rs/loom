import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?surface=agents`);
  const row = page
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .first();
  await row.click();
  await expect(
    page.getByRole("button", { name: "报告问题", exact: true }),
  ).toHaveCount(0);
  const header = page.locator(".rah-agent-detail-head");
  for (const entry of ["header", "context", "profile"]) {
    await header
      .getByRole("button", { name: "停止 Agent", exact: true })
      .click();
    const stop = page.getByRole("dialog", { name: "停止 Agent", exact: true });
    await stop.getByRole("button", { name: "停止 Agent", exact: true }).click();
    await expect(stop).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: "启动 Agent", exact: true }),
    ).toBeEnabled();
    if (entry === "header") {
      const keys = [];
      await page.route("**/v3/client/agents/manage", async (route) => {
        const body = route.request().postDataJSON();
        if (body.state !== "enabled") return route.continue();
        keys.push(body.idempotencyKey);
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (keys.length === 1)
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ error: "fixture start failure" }),
          });
        return route.continue();
      });
      const start = header.getByRole("button", {
        name: "启动 Agent",
        exact: true,
      });
      await start.click();
      await expect(start).toBeDisabled();
      await expect(
        page.locator(".rah-agent-detail-panel > [role=alert]"),
      ).toBeVisible();
      await expect(start).toBeEnabled();
      assert.equal(keys.length, 1);
      await start.click();
      await expect(
        header.getByRole("button", { name: "停止 Agent", exact: true }),
      ).toBeEnabled();
      assert.deepEqual(keys, [keys[0], keys[0]]);
      await page.unroute("**/v3/client/agents/manage");
      continue;
    }
    if (entry === "header")
      await header
        .getByRole("button", { name: "启动 Agent", exact: true })
        .click();
    else if (entry === "profile") {
      await page
        .locator(".rah-agent-profile-pane")
        .getByRole("button", { name: "启动 Agent", exact: true })
        .click();
    } else {
      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "启动", exact: true }).click();
    }
    await expect(
      page.getByRole("dialog", { name: "启动 Agent", exact: true }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: "停止 Agent", exact: true }),
    ).toBeEnabled();
  }
} finally {
  await browser.close();
  await fixture.close();
}
