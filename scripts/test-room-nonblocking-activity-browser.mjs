import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  for (const kind of ["agents/activity", "members"]) {
    const page = await browser.newPage();
    await page.route(`**/v3/client/rooms/${kind}/list`, async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 6500));
      await route.fulfill({ response }).catch(() => {});
    });
    await page.goto(fixture.origin);
    await expect(
      page.locator(".channel [data-message-id]").first(),
    ).toBeVisible({
      timeout: kind === "members" ? 10000 : 4000,
    });
    await page.close();
  }
  console.log(
    "PASS Room messages render while diagnostic activity is still pending",
  );
} finally {
  await browser.close();
  await fixture.close();
}
