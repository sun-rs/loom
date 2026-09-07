import assert from "node:assert/strict";
import { join } from "node:path";

// Isolated browser fault injection, not proof of OS Push delivery. No provider use.
export async function verifyPushReadStates(browser, origin, output, engine) {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => {
      localStorage.setItem("rah:web-push-desired:v1", "disabled");
      const probe = (window.__rahPushReadProbe = {
        mode: "pending",
        reads: 0,
        resolves: [],
        mutations: 0,
      });
      Object.defineProperty(navigator.serviceWorker, "getRegistration", {
        value: async () => ({
          update: async () => {},
          pushManager: {
            getSubscription: () => {
              probe.reads++;
              if (probe.mode === "pending")
                return new Promise((resolve, reject) =>
                  probe.resolves.push({ resolve, reject }),
                );
              if (probe.mode === "error")
                return Promise.reject(
                  new Error("Subscription read fixture failure"),
                );
              return Promise.resolve(null);
            },
            subscribe: async () => {
              probe.mutations++;
              throw new Error("Unexpected subscription mutation");
            },
          },
        }),
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error")
        errors.push(`${message.text()} ${message.location().url}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `${origin}/?surface=settings&settingsSection=notifications`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(() => window.__rahPushReadProbe.reads > 0);
    assert.equal(
      await page
        .locator(".rah-settings-push-card .rah-count-badge")
        .innerText(),
      "正在检查",
    );
    assert.equal(
      await page.getByText(/iPhone\/iPad/).count(),
      0,
      "loading must not claim iOS unsupported",
    );
    await page.evaluate(() => {
      const p = window.__rahPushReadProbe;
      p.mode = "error";
      for (const r of p.resolves.splice(0))
        r.reject(new Error("Subscription read fixture failure"));
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "Subscription read fixture failure" })
      .waitFor();
    assert.equal(await page.getByText(/iPhone\/iPad/).count(), 0);
    assert.match(
      await page.locator(".rah-settings-secondary").innerText(),
      /此设备订阅：未知/,
    );
    assert.match(
      await page.locator(".rah-settings-secondary").innerText(),
      /已登记设备数：未知/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "重新检查通知", exact: true })
        .isEnabled(),
      true,
    );
    await page.waitForFunction(() => {
      const retry = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "重新检查通知",
      );
      return retry && getComputedStyle(retry).opacity === "1";
    });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(output, `${engine}-push-read-error.png`),
    });
    await page.evaluate(() => {
      window.__rahPushReadProbe.mode = "ok";
    });
    await page
      .getByRole("button", { name: "重新检查通知", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(".rah-settings-push-card .rah-count-badge")
          ?.textContent === "已停用",
    );
    assert.equal(await page.getByRole("alert").count(), 0);
    // An older failure arriving after a newer focus refresh cannot erase recovery.
    await page.evaluate(() => {
      window.__rahPushReadProbe.mode = "pending";
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () => window.__rahPushReadProbe.resolves.length > 0,
    );
    await page.evaluate(() => {
      window.__rahPushReadProbe.mode = "ok";
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".rah-settings-push-card .rah-count-badge")
          ?.textContent === "已停用",
    );
    await page.evaluate(async () => {
      for (const r of window.__rahPushReadProbe.resolves.splice(0))
        r.reject(new Error("Late obsolete failure"));
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
    assert.equal(
      await page.getByRole("alert").count(),
      0,
      "late read must not undo recovery",
    );
    assert.equal(
      await page
        .locator(".rah-settings-push-card .rah-count-badge")
        .innerText(),
      "已停用",
    );
    assert.equal(
      await page.evaluate(() => window.__rahPushReadProbe.mutations),
      0,
    );
    await page.screenshot({
      path: join(output, `${engine}-push-read-recovered.png`),
    });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
