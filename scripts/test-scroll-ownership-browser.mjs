import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
).launch();
const failures = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width < 768,
      isMobile: width < 768,
    });
    const check = async (name, run) => {
      try {
        await run();
      } catch (error) {
        failures.push(`${width} ${name}: ${error.message}`);
      }
    };
    await check("search refresh does not recenter the thread", async () => {
      await page.goto(
        `${fixture.origin}/test/message-timeline.html?kind=thread`,
        { waitUntil: "networkidle" },
      );
      await page
        .getByRole("button", { name: "消息列操作", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "在消息列中搜索", exact: true })
        .click();
      await page
        .locator(".rah-thread-search input")
        .fill("Timeline fixture 00090");
      await expect(page.locator(".rah-thread-search > span")).toHaveText("1/1");
      const scroll = page.locator(".messages");
      await page.waitForTimeout(200);
      await scroll.evaluate((e) => {
        e.dispatchEvent(new Event("touchmove", { bubbles: true }));
        e.scrollTop += 250;
      });
      await page.waitForTimeout(100);
      const top = await scroll.evaluate((e) => e.scrollTop);
      await page.evaluate(() => window.refreshTimelineFixture());
      await page.waitForTimeout(200);
      assert.ok(
        Math.abs((await scroll.evaluate((e) => e.scrollTop)) - top) < 2,
        "unchanged search target must not scroll again on polling",
      );
      for (const action of ["button", "enter"]) {
        await scroll.evaluate((e) => {
          e.scrollTop += 180;
        });
        await page.waitForTimeout(100);
        const before = await scroll.evaluate((e) => e.scrollTop);
        if (action === "button")
          await page
            .getByRole("button", { name: "下一个搜索结果", exact: true })
            .click();
        else await page.locator(".rah-thread-search input").press("Enter");
        await page.waitForTimeout(150);
        assert.ok(
          Math.abs((await scroll.evaluate((e) => e.scrollTop)) - before) > 50,
          "an explicit search navigation still repositions a single result",
        );
      }
    });
    for (const kind of ["channel", "direct", "thread"])
      await check(
        `${kind} delayed history respects a newer reading position`,
        async () => {
          await page.goto(
            `${fixture.origin}/test/message-timeline.html?kind=${kind}&count=150&delay=1`,
            { waitUntil: "networkidle" },
          );
          const scroll = page.locator(".messages");
          await expect(scroll.locator(".msg").first()).toBeVisible();
          await scroll.evaluate((e) => {
            e.scrollTop = 0;
          });
          await page.waitForTimeout(250);
          await page.locator(".rah-message-history-trigger").click();
          await page.waitForFunction(() => !!window.finishTimelineEarlier);
          await scroll.evaluate((e) => {
            e.dispatchEvent(
              new WheelEvent("wheel", { deltaY: 260, bubbles: true }),
            );
            e.scrollTop += 260;
          });
          await page.waitForTimeout(250);
          const anchor = await scroll.evaluate((e) => {
            const top = e.getBoundingClientRect().top;
            const row = [...e.querySelectorAll(".msg")].find(
              (r) => r.getBoundingClientRect().bottom > top,
            );
            return {
              id: row.dataset.messageId,
              offset: row.getBoundingClientRect().top - top,
            };
          });
          await page.evaluate(() => window.finishTimelineEarlier());
          await page.waitForTimeout(1500);
          const offset = await scroll.evaluate((e, id) => {
            const row = e.querySelector(`[data-message-id="${id}"]`);
            return row
              ? row.getBoundingClientRect().top - e.getBoundingClientRect().top
              : null;
          }, anchor.id);
          assert.ok(
            offset !== null && Math.abs(offset - anchor.offset) < 3,
            JSON.stringify({ anchor, offset }),
          );
        },
      );
    for (const kind of ["channel", "direct"])
      await check(
        `${kind} scroll wins over an append before scroll event`,
        async () => {
          await page.goto(
            `${fixture.origin}/test/message-timeline.html?kind=${kind}&count=150`,
            { waitUntil: "networkidle" },
          );
          const scroll = page.locator(".messages");
          const before = await scroll.evaluate((e) => e.scrollTop);
          assert.ok(before > 200);
          await scroll.evaluate((e) => {
            e.scrollTop -= 200;
            window.appendTimelineFixture();
          });
          await page.waitForTimeout(300);
          assert.ok(
            (await scroll.evaluate(
              (e) => e.scrollHeight - e.scrollTop - e.clientHeight,
            )) > 100,
            "new message must not pull a reader back to the tail",
          );
        },
      );
    await check(
      "diagnostics scroll wins over an append before scroll event",
      async () => {
        await page.goto(`${fixture.origin}/test/scroll-ownership.html`, {
          waitUntil: "networkidle",
        });
        const scroll = page.locator(".rah-agent-activity-pane");
        const before = await scroll.evaluate((e) => e.scrollTop);
        assert.ok(before > 200);
        await page
          .getByRole("button", { name: "Scroll and append diagnostic" })
          .click();
        await page.waitForTimeout(200);
        assert.ok(
          Math.abs(
            (await scroll.evaluate((e) => e.scrollTop)) - (before - 200),
          ) < 2,
          "diagnostic append must not pull reading back to the tail",
        );
      },
    );
    for (const opener of ["Open thread", "Open search preview"])
      await check(`${opener} focus return preserves scroll`, async () => {
        await page.goto(`${fixture.origin}/test/scroll-ownership.html`, {
          waitUntil: "networkidle",
        });
        const scroll = page.getByTestId("focus-scroll");
        await page.getByRole("button", { name: opener, exact: true }).click();
        await scroll.evaluate((e) => {
          e.scrollTop = 300;
        });
        await page
          .getByRole("button", { name: "Close preview", exact: true })
          .click();
        await page.waitForTimeout(200);
        assert.equal(await scroll.evaluate((e) => e.scrollTop), 300);
      });
    await check(
      "task initial positioning releases on reading input",
      async () => {
        await page.goto(`${fixture.origin}/test/scroll-ownership.html`, {
          waitUntil: "networkidle",
        });
        const scroll = page.getByTestId("task-initial-scroll");
        await expect
          .poll(() => scroll.evaluate((e) => e.scrollTop))
          .toBeGreaterThan(500);
        await scroll.evaluate((e) => {
          e.dispatchEvent(new Event("touchstart", { bubbles: true }));
          e.scrollTop = 200;
        });
        await page
          .getByRole("button", { name: "Resize task content", exact: true })
          .click();
        await page.waitForTimeout(200);
        assert.equal(await scroll.evaluate((e) => e.scrollTop), 200);
      },
    );
    await page.close();
  }
  console.log(JSON.stringify({ failures }));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
