import assert from "node:assert/strict";
import { showChatList } from "./mobile-chat-browser.mjs";
export async function verifyNotifications({ browser, origin, channels }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      let notices = [
        {
          kind: "computer_offline",
          computerName: "FIXTURE offline computer",
          dismissible: true,
          notificationId: "fixture-offline",
          target: { kind: "computer", hostId: "fixture-host" },
        },
      ];
      let writes = [];
      await page.route("**/v3/client/notifications/list", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ notifications: notices }),
        }),
      );
      await page.route("**/v3/client/notifications/dismiss", (route) => {
        writes.push(route.request().postDataJSON());
        notices = [];
        return route.abort();
      });
      await page.goto(origin + "/?room=" + channels[0].roomId);
      if (width === 390) await showChatList(page);
      const trigger = page.getByTestId(
        width === 390
          ? "notification-trigger-mobile"
          : "notification-trigger-top-bar",
      );
      await trigger.waitFor({ timeout: 10000 }).catch(async (error) => {
        throw new Error(
          JSON.stringify({
            errors,
            body: await page.locator("body").innerText(),
          }),
          { cause: error },
        );
      });
      if (width !== 390) {
        assert.equal(
          await page
            .getByTestId("app-top-bar")
            .getByTestId("notification-trigger-top-bar")
            .count(),
          1,
        );
        assert.equal(
          await page.getByTestId("notification-trigger-rail").count(),
          0,
        );
        assert.equal((await trigger.boundingBox()).height, 36);
      }
      await trigger.click();
      await page.getByTestId("notification-center").waitFor();
      await page.getByText(/FIXTURE offline computer/).waitFor();
      await page
        .getByTestId("notification-center")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page
        .getByText("关闭结果未确认，已重新读取；不会自动重发。")
        .waitFor();
      assert.equal(writes.length, 1);
      assert.ok(writes[0].idempotencyKey);
      await page.getByRole("button", { name: "重新读取", exact: true }).click();
      await page
        .getByText("关闭结果未确认，已重新读取；不会自动重发。")
        .waitFor({ state: "detached" });
      assert.equal(writes.length, 1);
      await page.screenshot({ path: `/tmp/loom-notifications-${width}.png` });
      await page.keyboard.press("Escape");
      await page
        .getByTestId("notification-center")
        .waitFor({ state: "detached" });
      assert.equal(
        await trigger.evaluate((el) => el === document.activeElement),
        true,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        notificationFixture: true,
        nativeTriggerAndPopup: true,
        lostDismissNoReplay: true,
        escapeFocus: true,
        secureContext: await page.evaluate(() => isSecureContext),
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
