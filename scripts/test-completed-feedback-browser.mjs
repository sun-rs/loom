import { createServer } from "vite";
import { chromium, expect } from "playwright/test";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(
    server.resolvedUrls.local[0] +
      "test/runtime-guide-fixture.html?settingsSection=appearance",
  );
  await expect(p.getByRole("group", { name: "消息字号" })).toBeVisible();
  await expect(p.getByText("已保存到此设备。", { exact: true })).toHaveCount(0);
  await p.getByRole("button", { name: "大", exact: true }).click();
  await expect(p.locator(".rah-settings-saved")).toHaveCount(0);
  await p.screenshot({
    path: "/tmp/rah-completed-feedback-settings.png",
    fullPage: true,
  });
  await p.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new Error("Fixture storage denied");
    };
  });
  await p.getByRole("button", { name: "小", exact: true }).click();
  await expect(
    p.getByRole("alert").filter({ hasText: "无法保存到此设备" }),
  ).toBeVisible();
  await p.goto(
    server.resolvedUrls.local[0] + "test/completed-feedback-fixture.html",
  );
  const radios = p.getByRole("radio");
  for (const radio of await radios.all()) {
    if (!(await radio.isChecked())) {
      await radio.check();
      break;
    }
  }
  await p.getByRole("button", { name: "保存日期与时间" }).click();
  await expect(
    p.getByRole("button", { name: "保存日期与时间" }),
  ).toBeDisabled();
  await expect(p.locator(".rah-settings-saved")).toHaveCount(0);
  let generation = "fixture-before";
  await p.route("**/_rah/service", (route) =>
    route.fulfill({ json: { available: true, state: "online", generation } }),
  );
  await p.route("**/_rah/service/restart", (route) => {
    generation = "fixture-after";
    return route.fulfill({ status: 202, json: { result: "accepted" } });
  });
  await p.goto(
    server.resolvedUrls.local[0] +
      "test/completed-feedback-fixture.html?mode=restart",
  );
  await p.getByRole("button", { name: "重启服务", exact: true }).click();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "重启服务", exact: true })
    .click();
  await expect(
    p.getByRole("button", { name: "重启服务", exact: true }),
  ).toBeEnabled();
  await expect(p.getByRole("status")).toHaveCount(0);
  await p.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "granted" });
    navigator.serviceWorker.getRegistration = async () => ({
      update: async () => {},
      pushManager: { getSubscription: async () => ({}) },
    });
  });
  await p.goto(
    server.resolvedUrls.local[0] +
      "test/completed-feedback-fixture.html?mode=push",
  );
  await p.getByRole("button", { name: "发送测试推送" }).click();
  await expect(p.locator("body")).toHaveAttribute("data-push-test", "accepted");
  await expect(p.locator(".rah-settings-success")).toHaveCount(0);
  console.log(
    "PASS appearance/date settings, push and restart successes allocate no notice; storage failures remain visible",
  );
} finally {
  await browser.close();
  await server.close();
}
