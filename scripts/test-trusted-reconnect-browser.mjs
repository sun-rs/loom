import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser =
  process.env.RAH_RECOVERY_ENGINE === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        headless: true,
        executablePath: await findChromeExecutable(),
      });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = true;
  await page.route("**/v3/client/**", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "unavailable",
              message: "Injected reconnect failure",
            },
          }),
        })
      : route.continue(),
  );
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  const reconnect = page
    .locator(".rah-error")
    .getByRole("button", { name: "重新连接" });
  await reconnect.waitFor();
  fail = false;
  await reconnect.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".rah-connect-card") ||
      document.querySelector(
        'textarea[aria-label="消息输入框"]:not(:disabled)',
      ),
  );
  assert.equal(
    await page.locator(".rah-connect-card").count(),
    0,
    "trusted reconnect must never demand a token",
  );
  await page
    .locator('textarea[aria-label="消息输入框"]:not(:disabled)')
    .waitFor();
  await page.close();

  const delayedPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await delayedPage.route("**/*rah_build_probe=*", () => {});
  await delayedPage.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await delayedPage
    .locator('textarea[aria-label="消息输入框"]:not(:disabled)')
    .waitFor({ timeout: 2500 });
  await delayedPage.locator("[data-message-id]").first().waitFor();
  await delayedPage.close();

  const mismatchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await mismatchPage.route("**/*rah_build_probe=*", (route) =>
    route.fulfill({
      status: 200,
      headers: { "x-rah-web-build-id": "fixture-next-build" },
      body: "",
    }),
  );
  await mismatchPage.route("**/v3/client/**", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "x-rah-web-build-id": "fixture-next-build",
      },
    });
  });
  await mismatchPage.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await mismatchPage.getByRole("dialog").waitFor();
  await mismatchPage
    .locator("[data-message-id]")
    .first()
    .waitFor({ timeout: 5000 });
  await mismatchPage
    .getByRole("button", { name: "仍然继续", exact: true })
    .click();
  await mismatchPage
    .locator('textarea[aria-label="消息输入框"]:not(:disabled)')
    .waitFor();
  await mismatchPage.goto(`${fixture.origin}/?surface=agents`);
  await mismatchPage.getByRole("dialog").waitFor();
  await mismatchPage
    .locator(".rah-agent-member-row")
    .first()
    .waitFor({ timeout: 5000 });
  await mismatchPage
    .getByRole("button", { name: "仍然继续", exact: true })
    .click();
  assert.equal(await mismatchPage.locator(".rah-connect-card").count(), 0);
  console.log(
    "Trusted reconnect, delayed probe and version mismatch preserve messages/Agents (isolated fixture)",
  );
} finally {
  await browser.close();
  await fixture.close();
}
