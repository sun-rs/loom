import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let calls = 0;
  let inboxCalls = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/input-requests/list")) inboxCalls++;
  });
  let hiddenRoomReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v3/client/rooms/sync")
      hiddenRoomReads++;
  });
  await page.route("**/v3/client/tasks/global", async (route) => {
    calls++;
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 6500));
    await route.fulfill({ response }).catch(() => {});
  });
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await expect(page.getByRole("main", { name: "全局任务" })).toBeVisible();
  await expect(page.locator(".rah-discovery .rah-loading-state")).toBeVisible();
  await expect(page.locator(".rah-discovery .rah-loading-state")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.getByRole("main", { name: "全局任务" })).toBeVisible();
  await page.screenshot({
    path: `/tmp/loading-pending-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await page.waitForTimeout(1000);
  const bootstrapCalls = calls;
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("focus"));
  });
  // Focus legitimately refreshes notification state once; repeated focus while
  // that read is pending coalesces. The following five-second tick must not fan out.
  await page.waitForTimeout(500);
  const bootstrapInboxCalls = inboxCalls;
  await expect(page.locator(".rah-global-card-open").first()).toBeVisible({
    timeout: 10000,
  });
  assert.equal(
    calls,
    bootstrapCalls,
    "slow initial read is not restarted by polling",
  );
  assert.equal(
    inboxCalls,
    bootstrapInboxCalls,
    "closed inbox avoids five-second per-Room fan-out",
  );
  assert.equal(
    hiddenRoomReads,
    0,
    "Tasks does not reconcile an invisible Room",
  );
  await page.screenshot({
    path: `/tmp/loading-ready-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await expect
    .poll(() => calls, { timeout: 7000 })
    .toBeGreaterThan(bootstrapCalls);
  await expect(page.locator(".rah-global-card-open").first()).toBeVisible();
  await expect(page.locator(".rah-discovery .rah-loading-state")).toHaveCount(
    0,
  );
  const recovery = await browser.newPage();
  let failing = true;
  await recovery.route("**/v3/client/tasks/global", (route) =>
    failing
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "FAKE unavailable" }),
        })
      : route.continue(),
  );
  await recovery.goto(`${fixture.origin}/?surface=tasks`);
  await expect(recovery.getByRole("alert").first()).toBeVisible();
  await expect(
    recovery.locator(".rah-discovery .rah-loading-state"),
  ).toHaveCount(0);
  failing = false;
  await recovery.getByRole("button", { name: "重试", exact: true }).click();
  await expect(recovery.locator(".rah-global-card-open").first()).toBeVisible();
  await recovery.close();
  console.log(
    "PASS delayed task data renders without five-second cancellation",
  );
} finally {
  await browser.close();
  await fixture.close();
}
