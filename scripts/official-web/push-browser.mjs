import assert from "node:assert/strict";
export async function verifyPush({ browser, origin, channels }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      permissions: ["notifications"],
    });
    try {
      await context.addInitScript(() => {
        window.__pushFixture = { local: null, permissionCalls: 0 };
        Object.defineProperty(Notification, "permission", {
          configurable: true,
          get: () => "granted",
        });
        Notification.requestPermission = async () => {
          window.__pushFixture.permissionCalls++;
          return "granted";
        };
        Object.defineProperty(
          ServiceWorkerRegistration.prototype,
          "pushManager",
          {
            configurable: true,
            get() {
              return {
                getSubscription: async () => window.__pushFixture.local,
                subscribe: async () => {
                  const subscription = {
                    endpoint: "https://push.example/FIXTURE-current-browser",
                    toJSON() {
                      return {
                        endpoint: this.endpoint,
                        expirationTime: null,
                        keys: { auth: "fixtureauth", p256dh: "fixturekey" },
                      };
                    },
                    async unsubscribe() {
                      window.__pushFixture.local = null;
                      return true;
                    },
                  };
                  window.__pushFixture.local = subscription;
                  return subscription;
                },
              };
            },
          },
        );
      });
      const page = await context.newPage(),
        errors = [],
        writes = [];
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(e.message));
      for (const operation of ["subscribe", "unsubscribe"]) {
        await page.route(`**/v3/client/push/${operation}`, async (route) => {
          writes.push(operation);
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort();
        });
      }
      await page.route("**/v3/client/push/test", async (route) => {
        writes.push("test");
        await route.fulfill({ json: { delivered: 1 } });
      });
      await page.goto(origin + "/?view=settings&settings=notifications");
      await page
        .getByText("未启用", { exact: true })
        .waitFor()
        .catch(async (error) => {
          console.log(await page.locator("body").innerText());
          console.log(errors);
          throw error;
        });
      assert.equal(
        await page.evaluate(() => window.__pushFixture.permissionCalls),
        0,
      );
      await page
        .getByRole("button", { name: "启用推送通知", exact: true })
        .click();
      await page.getByText("已启用", { exact: true }).waitFor();
      assert.deepEqual(writes, ["subscribe"]);
      const script = await page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/"))?.active
            ?.scriptURL,
      );
      assert.equal(script, origin + "/loom-push-sw.js");
      const testButton = page.getByRole("button", { name: /发送测试推送/ });
      await testButton.click();
      await page.getByText(/推送服务已接受 1 个设备/).waitFor();
      await page.screenshot({ path: `/tmp/loom-push-settings-${width}.png` });
      await page
        .getByRole("button", { name: "停用推送通知", exact: true })
        .click();
      await page.getByText("未启用", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__pushFixture.local), null);
      assert.deepEqual(writes, ["subscribe", "test", "unsubscribe"]);
      // The real initial notification route validates against the temporary Kernel.
      const target = { kind: "room", roomId: channels[0].roomId };
      await page.goto(
        origin + "/?" + new URLSearchParams({ push: JSON.stringify(target) }),
      );
      await page.waitForURL(
        (u) =>
          u.searchParams.get("room") === channels[0].roomId &&
          !u.searchParams.has("push"),
      );
      await page.getByTestId("composer-textarea").waitFor();
      await page.goto(
        origin +
          "/?" +
          new URLSearchParams({
            push: JSON.stringify({
              kind: "room",
              roomId: "inaccessible-fixture-room",
            }),
          }),
      );
      await page.getByTestId("push-navigation-error").waitFor();
      await page
        .getByTestId("push-navigation-error")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page
        .getByTestId("push-navigation-error")
        .waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        nativeControls: true,
        realWorkerRegistered: true,
        fakeBrowserSubscription: true,
        realDaemonRegistrationReadback: true,
        lostWritesVerifiedWithoutResend: true,
        testReceiptNotDeliveryClaim: true,
        authenticatedNavigation: true,
        deniedTargetDoesNotNavigate: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
