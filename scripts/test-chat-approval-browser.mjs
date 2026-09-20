import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-chat-approval-`),
  failures = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
      ...(width === 390
        ? {
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
          }
        : {}),
    });
    const page = await context.newPage();
    if (width === 390)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "standalone", { value: true }),
      );
    await page.addInitScript(() => {
      window.__scrollCalls = [];
      const scroll = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (...args) {
        if (this.matches?.("main.channel .messages"))
          window.__scrollCalls.push({ args, stack: new Error().stack });
        return scroll.apply(this, args);
      };
    });
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: "Keep the Room-first delivery contract" })
      .first();
    await expect(card).toBeVisible();
    const roomId = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    async function topOfChat() {
      const scroller = page.locator("main.channel .messages");
      await expect(
        page.getByRole("textbox", { name: "消息输入框", exact: true }),
      ).toBeEnabled();
      await scroller.hover();
      if (width === 390 && process.env.RAH_UI_BROWSER === "webkit") {
        // Playwright has no native swipe API for mobile WebKit; release the
        // touch reading pin, then place the fixture at its oldest loaded row.
        await scroller.dispatchEvent("touchmove");
        await scroller.evaluate((e) => {
          e.scrollTop = 0;
        });
      } else await page.mouse.wheel(0, -100000);
      await expect.poll(() => scroller.evaluate((e) => e.scrollTop)).toBe(0);
      await page.waitForTimeout(300);
    }
    async function check(name, run) {
      try {
        await run();
      } catch (e) {
        failures.push(`${width} ${name}: ${e.message}`);
        console.log(
          width,
          name,
          e.message,
          await page.evaluate(() => window.__scrollCalls?.slice(-4)),
        );
        await page.screenshot({
          path: `${evidence}/${width}-${name}-failure.png`,
        });
      }
    }
    await check("avatar", async () => {
      await page.goto(`${fixture.origin}/?room=${roomId}`);
      await topOfChat();
      const avatar = page
        .locator("main.channel .rah-message-avatar-trigger")
        .first();
      await expect(avatar).toBeVisible();
      await avatar.scrollIntoViewIfNeeded();
      const box = await avatar.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      try {
        assert.deepEqual(
          await avatar.boundingBox(),
          box,
          "press must not move avatar",
        );
      } finally {
        await page.mouse.up();
      }
      const panel = page.locator(".rah-agent-peek");
      await expect(panel).toBeVisible();
      if (width === 390) {
        const back = panel.getByRole("button", {
          name: "返回聊天",
          exact: true,
        });
        await expect(back).toBeVisible();
        assert.equal((await back.boundingBox()).width, 32);
        await expect(
          panel.getByRole("button", { name: /关闭 (Agent|Human) 侧栏/ }),
        ).toBeHidden();
        await back.tap();
      } else
        await panel
          .getByRole("button", { name: /关闭 (Agent|Human) 侧栏/ })
          .click();
    });
    await check("badge", async () => {
      await page.goto(`${fixture.origin}/?room=${roomId}`);
      const composer = page.getByRole("textbox", {
        name: "消息输入框",
        exact: true,
      });
      await expect(composer).toBeEnabled();
      for (let i = 0; i < 8; i++) {
        await composer.fill(
          `FAKE reading position ${width}-${i}\n${"Long source reading line\n".repeat(6)}`,
        );
        await composer.press("Enter");
        await expect(composer).toHaveValue("");
      }
      await page.reload();
      await topOfChat();
      const badge = page.getByTestId("message-task-badge").first();
      await expect(badge).toBeVisible();
      await badge.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.__reading = document.querySelector("main.channel .messages");
        window.__reading.scrollTop = Math.max(
          0,
          window.__reading.scrollTop - 25,
        );
      });
      const read = () =>
        page.evaluate(() => ({
          top: window.__reading.scrollTop,
          connected: window.__reading.isConnected,
          box: window.__reading.getBoundingClientRect().toJSON(),
        }));
      await page.evaluate(() => {
        window.__scrollCalls = [];
      });
      const before = await read();
      assert.ok(
        await page.evaluate(
          () =>
            window.__reading.scrollHeight - window.__reading.clientHeight > 600,
        ),
        "must test a genuinely scrollable conversation",
      );
      await badge.click();
      const modal = page.getByTestId("task-thread-modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByTestId("task-detail-metadata")).toBeVisible();
      if (width === 1440) {
        const reply = modal.getByRole("textbox", {
          name: "Thread 回复输入框",
          exact: true,
        });
        await expect(reply).toBeEnabled();
        await reply.fill("FAKE approval typography sample");
        await reply.press("Enter");
        await expect(modal.locator(".msg-body").first()).toBeVisible();
        for (const body of await modal.locator(".msg-body").all())
          await expect(body).toHaveCSS("font-size", "14px");
      }
      assert.deepEqual(
        await read(),
        before,
        "approval must leave reading DOM, offset and geometry intact",
      );
      if (width === 390) {
        const box = await modal.boundingBox();
        assert.ok(
          box.x > 0 && box.y > 0 && box.width < 390 && box.height < 844,
          "compact inset approval",
        );
        await expect(modal.locator(".msg,textarea")).toHaveCount(0);
        await modal.getByRole("button", { name: "操作时间线" }).click();
        await expect(
          modal.locator(".rah-task-detail-history-body"),
        ).toBeVisible();
        const max = await modal
          .locator(".rah-task-detail-history-body")
          .evaluate((e) => parseFloat(getComputedStyle(e).maxHeight));
        assert.ok(max > 0 && max < 300, "timeline has bounded internal scroll");
      }
      await page.screenshot({ path: `${evidence}/${width}-badge.png` });
      await modal
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      await expect(modal).toBeHidden();
      await expect.poll(read).toEqual(before);
      await page.waitForTimeout(5500);
      assert.deepEqual(
        await read(),
        before,
        "polling must not reset source reading position",
      );
    });
    await check("thread-approval", async () => {
      await page.goto(`${fixture.origin}/?room=${roomId}&roomTab=tasks`);
      await page.locator(".rah-global-card-open").first().click();
      const full = page.getByTestId("task-thread-modal");
      const composer = full.getByRole("textbox", {
        name: "Thread 回复输入框",
        exact: true,
      });
      await expect(composer).toBeEnabled();
      await composer.fill(
        `FAKE thread anchor task #1\n${"Long reply for reading position\n".repeat(30)}`,
      );
      await composer.press("Enter");
      await expect(composer).toHaveValue("");
      await page.goto(`${fixture.origin}/?room=${roomId}`);
      await topOfChat();
      const preview = page.locator(".thread-preview").first();
      await expect(preview).toBeVisible();
      await preview.click();
      const thread = page.getByTestId("thread-side-column");
      await expect(thread).toBeVisible();
      const badge = thread.getByTestId("message-task-badge").first();
      await expect(badge).toBeVisible();
      await badge.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.__thread = document.querySelector(".app > .thread .messages");
      });
      const read = () =>
        page.evaluate(() => ({
          top: window.__thread.scrollTop,
          connected: window.__thread.isConnected,
          box: window.__thread.getBoundingClientRect().toJSON(),
        }));
      const before = await read();
      await badge.click();
      await expect(full).toBeVisible();
      await expect(full.getByTestId("task-detail-metadata")).toBeVisible();
      assert.deepEqual(await read(), before);
      await full
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      await expect(full).toBeHidden();
      await expect.poll(read).toEqual(before);
      await page.screenshot({ path: `${evidence}/${width}-thread-return.png` });
    });
    await check("dm-agent-return", async () => {
      await page.goto(fixture.origin);
      const dm = page
        .locator('[data-sidebar-group="dms"] [data-sidebar-key]')
        .first();
      const key = await dm.getAttribute("data-sidebar-key");

      await page.locator(`[data-sidebar-key="${key}"] button`).first().click();
      await expect(page.locator(".rah-direct-title")).toBeVisible();
      const avatar = page.locator(".rah-direct-header-avatar");
      await avatar.click();
      const panel = page.locator(".rah-agent-peek");
      await expect(panel).toBeVisible();
      await page.screenshot({ path: `${evidence}/${width}-agent.png` });
      const back = panel.getByRole("button", { name: "返回聊天", exact: true });
      if (width === 390) {
        await expect(back).toBeVisible();
        assert.equal((await back.boundingBox()).width, 32);
        await back.tap();
      } else
        await panel
          .getByRole("button", { name: "关闭 Agent 侧栏", exact: true })
          .click();
      await expect(page.locator(".rah-direct-title")).toBeVisible();
    });
    await context.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
