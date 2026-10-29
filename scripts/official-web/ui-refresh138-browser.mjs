// Isolated real Core fixture; no provider execution or product data.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
export async function verifyUIRefresh138({
  browser,
  origin,
  client,
  channels,
  head,
}) {
  const room = channels[0],
    output = process.env.LOOM_UI_SCREENSHOT_DIR ?? "/tmp/loom-ui-refresh138";
  await mkdir(output, { recursive: true });
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE selection alpha beta",
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "ui138-selection",
  });
  const post = (
    await client.request("message.list", { roomId: room.roomId, limit: 50 })
  ).messages.find((m) => m.body === "FIXTURE selection alpha beta");
  assert.ok(post);
  const task = (
    await client.request("task.create", {
      roomId: room.roomId,
      title: "FIXTURE compact task head",
      description: "FIXTURE task details",
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: "ui138-task",
    })
  ).task;
  for (let i = 0; i < 20; i++)
    await client.request("thread.reply", {
      roomId: room.roomId,
      threadId: task.threadId,
      body: `FIXTURE task reply ${i}\n` + "Long reply content. ".repeat(30),
      recipientIds: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `ui138-reply-${i}`,
    });
  const result = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
      deviceScaleFactor: 1,
      locale: "zh-CN",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(7000);
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.goto(`${origin}/?view=channels&room=${room.roomId}`);
      const row = page.locator(`#message-${post.messageId}`);
      await row.waitFor();
      if (width === 1440)
        assert.equal(
          await page
            .getByTestId("left-rail-tab-channels")
            .locator("svg circle")
            .count(),
          3,
        );
      else {
        const content = row.locator("[data-message-id]");
        const rect = await content.boundingBox();
        assert.ok(rect);
        const cdp = await context.newCDPSession(page);
        const point = {
          x: rect.x + Math.min(rect.width / 2, 90),
          y: rect.y + Math.min(rect.height / 2, 16),
        };
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [point],
        });
        await content.dispatchEvent("contextmenu", {
          clientX: point.x,
          clientY: point.y,
        });
        await page
          .getByRole("menuitem", { name: "选择文本", exact: true })
          .waitFor();
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await page
          .getByRole("menuitem", { name: "选择文本", exact: true })
          .tap();
        const text = page.locator("[data-message-select-text-body]");
        await text.waitFor();
        await page.screenshot({ path: `${output}/select-text-${width}.png` });
        await text.evaluate((el) => {
          el.focus();
          const i = el.value.indexOf("alpha");
          el.setSelectionRange(i, i + 5);
        });
        await page
          .locator("[data-message-select-text]")
          .getByRole("button", { name: "引用", exact: true })
          .tap();
        await page.waitForFunction(
          () => !document.querySelector("[data-message-select-text-body]"),
        );
        await page.waitForFunction(() =>
          [
            ...document.querySelectorAll('[contenteditable="true"], textarea'),
          ].some((el) =>
            (el.value ?? el.textContent ?? "").includes("> alpha"),
          ),
        );
      }
      await page.goto(
        `${origin}/?view=tasks&taskRoom=${room.roomId}&task=${task.taskId}&taskChannel=${room.roomId}`,
      );
      await page.getByTestId("task-modal-title").waitFor();
      if (width === 390) {
        const scroll = page.getByTestId("thread-message-scroller");
        await scroll.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const summary = page.getByTestId("task-modal-bar-summary");
        await summary.waitFor();
        await summary.tap();
        await page.getByTestId("task-head-pull-down").waitFor();
        assert.equal(await summary.getAttribute("aria-expanded"), "true");
        await page.waitForFunction(() =>
          document
            .querySelector('[data-testid="task-head-pull-down"]')
            ?.getAnimations()
            .every((a) => a.playState === "finished"),
        );
        await page.screenshot({ path: `${output}/task-head-${width}.png` });
        await page.getByTestId("task-head-pull-down").press("Escape");
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="task-head-pull-down"]'),
        );
        assert.equal(
          await summary.getAttribute("aria-expanded"),
          "false",
          "Escape closes only the pull-down",
        );
        assert.equal(
          await page.getByTestId("task-modal-mobile-back").count(),
          1,
          "Escape retains the task",
        );
        await summary.tap();
        await page.getByTestId("task-head-pull-down").waitFor();
        await page.getByTestId("task-modal-mobile-back").tap();
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-testid="task-modal-mobile-back"]'),
        );
      }
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      result.push({
        width,
        officialChatIcon: width === 1440,
        partialTextQuote: width === 390,
        taskHeadDisclosure: width === 390,
        errors,
      });
    } finally {
      await context.close();
    }
  }
  return result;
}
