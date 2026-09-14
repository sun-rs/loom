import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let fail = true,
    attempts = 0;
  await page.route("**/v3/client/agents/list", (route) => {
    attempts++;
    return fail ? route.abort("failed") : route.continue();
  });
  await page.goto(fixture.origin + "/?surface=agents");
  await page.waitForTimeout(2000);
  assert.ok(attempts > 0);
  fail = false;
  // No reload, click or focus event: durable catalog must recover on its own.
  await page
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .first()
    .waitFor({ timeout: 12000 });
  const before = await page.locator(".rah-agent-member-row").allTextContents();
  assert.ok(before.length > 1);
  const seen = attempts;
  fail = true;
  await page.waitForTimeout(6000);
  assert.ok(attempts > seen);
  assert.deepEqual(
    await page.locator(".rah-agent-member-row").allTextContents(),
    before,
  );
  fail = false;
  await page.waitForTimeout(6000);
  assert.deepEqual(
    await page.locator(".rah-agent-member-row").allTextContents(),
    before,
  );
  console.log(
    "Agent directory initial failure, automatic recovery and transient failure retention passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
