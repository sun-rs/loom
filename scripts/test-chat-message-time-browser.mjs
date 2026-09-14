import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const engine = process.env.RAH_BROWSER === "firefox" ? firefox : chromium;
const b = await engine.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const p = await b.newPage({ viewport, timezoneId: "Asia/Shanghai" });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.clock.install({ time: new Date("2026-09-14T23:59:54+08:00") });
    await p.clock.pauseAt(new Date("2026-09-14T23:59:55+08:00"));
    await p.goto(f.origin + "/test/chat-message-time-fixture.html");
    const stamp = (id) => p.locator(`[data-message-id="${id}"] .msg-head time`);
    await expect(stamp("today")).toHaveText("12:34");
    await expect(stamp("human")).toHaveText("12:33");
    await expect(stamp("yesterday")).toHaveText("昨天 13:07");
    await expect(stamp("earlier")).toHaveText("09/02 22:39");
    await expect(
      p.locator('[data-message-id="today"] .rah-message-agent-model + time'),
    ).toHaveText("12:34");
    await p
      .getByRole("textbox", { name: "保留草稿" })
      .fill("Keep my draft across midnight");
    await p.evaluate(() => {
      window.fixtureMessageNode = document.querySelector(
        '[data-message-id="today"]',
      );
    });
    await p.screenshot({
      path: `/tmp/rah-chat-dates-${engine.name()}-${viewport.width}-before.png`,
    });
    await p.clock.runFor(4999);
    await expect(stamp("today")).toHaveText("12:34");
    await p.clock.runFor(1);
    await expect(stamp("today")).toHaveText("昨天 12:34");
    await expect(stamp("human")).toHaveText("昨天 12:33");
    await expect(stamp("yesterday")).toHaveText("09/13 13:07");
    await expect(
      p.locator('[data-fixture-date="today"] .rah-chat-date-divider time'),
    ).toHaveText("昨天");
    assert.equal(
      await p.evaluate(
        () =>
          window.fixtureMessageNode ===
          document.querySelector('[data-message-id="today"]'),
      ),
      true,
    );
    await expect(p.getByRole("textbox", { name: "保留草稿" })).toHaveValue(
      "Keep my draft across midnight",
    );
    await p.screenshot({
      path: `/tmp/rah-chat-dates-${engine.name()}-${viewport.width}-after.png`,
    });
    // Simulate a suspended tab resuming after multiple days without timer delivery.
    await p.clock.setSystemTime(new Date("2026-09-17T10:00:00+08:00"));
    await p.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(stamp("today")).toHaveText("09/14 12:34");
    await p.clock.setSystemTime(new Date("2026-09-15T10:00:00+08:00"));
    await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(stamp("today")).toHaveText("昨天 12:34");
    await p.reload();
    await expect(stamp("today")).toHaveText("昨天 12:34");
    assert.deepEqual(errors, []);
    assert.ok(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.close();
    console.log(
      engine.name(),
      viewport.width,
      "calendar prefixes, exact midnight, resume, stable message/draft and reload passed",
    );
  }
} finally {
  await b.close();
  await f.close();
}
