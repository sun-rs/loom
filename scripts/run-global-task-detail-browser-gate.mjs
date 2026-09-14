import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = process.env.RAH_TASK_DETAIL_EVIDENCE;
if (!output) throw new Error("RAH_TASK_DETAIL_EVIDENCE is required");
mkdirSync(output, { recursive: true });
const results = [];
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const title =
  "Keep the Room-first delivery contract stable across a deliberately long Task title";
for (const engine of process.env.RAH_UI_BROWSER
  ? [process.env.RAH_UI_BROWSER]
  : ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() =>
        localStorage.setItem("rah:web-push-desired:v1", "disabled"),
      );
      await page.goto(fixture.origin + "/?surface=tasks", {
        waitUntil: "domcontentloaded",
      });
      const card = page
        .locator(".rah-global-card-open")
        .filter({ hasText: title });
      await expect(card).toBeVisible();
      const roomId = await card.evaluate(
        (element) => element.closest("[data-task-room-id]").dataset.taskRoomId,
      );
      const taskId = await card.evaluate(
        (element) => element.closest("[data-task-id]").dataset.taskId,
      );
      // Chat badges must use the same canonical task dialog as the board.
      await page.goto(fixture.origin + "/?room=" + roomId);
      const badge = page
        .locator(
          '[data-testid="message-task-badge"][aria-label*="Keep the Room-first"]',
        )
        .first();
      await expect(badge).toBeVisible();
      await badge.click();
      const chatModal = page.getByTestId("task-thread-modal");
      await expect(chatModal).toBeVisible();
      await expect(chatModal.getByTestId("task-detail-metadata")).toBeVisible();
      assert.notEqual(new URL(page.url()).searchParams.get("surface"), "tasks");
      await expect(
        chatModal.locator(".rah-task-status-picker button").first(),
      ).toBeEnabled();
      await expect(
        chatModal.getByRole("button", { name: /^任务负责人：/ }),
      ).toBeEnabled();
      const chatReply = `CHAT_TASK_FAKE_FIXTURE_${engine}_${width}`;
      const chatComposer = chatModal.getByRole("textbox", {
        name: "Thread 回复输入框",
      });
      await chatComposer.fill(chatReply);
      await chatComposer.press("Enter");
      await expect(
        chatModal.locator(".msg-body").filter({ hasText: chatReply }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: join(output, `${engine}-${width}-chat-task.png`),
      });
      await page.reload();
      await expect(chatModal).toBeVisible();
      await expect(
        chatModal.locator(".msg-body").filter({ hasText: chatReply }).first(),
      ).toBeVisible();
      const chatStatus = chatModal
        .locator(".rah-task-status-picker button")
        .first();
      await chatStatus.click();
      await page
        .getByRole("menuitemradio", { name: "已关闭", exact: true })
        .click();
      await expect(badge).toHaveAttribute("data-task-status", "closed", {
        timeout: 15000,
      });
      const closedColor = await badge.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      await chatStatus.click();
      await page
        .getByRole("menuitemradio", { name: "待办", exact: true })
        .click();
      await expect(badge).toHaveAttribute("data-task-status", "todo", {
        timeout: 15000,
      });
      assert.notEqual(
        await badge.evaluate((e) => getComputedStyle(e).backgroundColor),
        closedColor,
      );
      await chatModal
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      await expect(chatModal).toHaveCount(0);
      assert.equal(new URL(page.url()).searchParams.get("room"), roomId);
      const boardQuery = new URLSearchParams({
        surface: "tasks",
        channel: roomId,
        view: "list",
      });
      await page.goto(fixture.origin + "/?" + boardQuery, {
        waitUntil: "domcontentloaded",
      });
      const originalBoardBox = await page
        .getByRole("main", { name: "全局任务" })
        .boundingBox();
      await card.click();
      const modal = page.getByRole("dialog", { name: /任务 #\d+ 详情/ });
      await expect(modal).toBeVisible();
      await expect(modal.getByRole("heading", { name: title })).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get("surface"), "tasks");
      assert.equal(new URL(page.url()).searchParams.get("channel"), roomId);
      assert.equal(new URL(page.url()).searchParams.get("view"), "list");
      await expect(page.getByRole("main", { name: "全局任务" })).toBeVisible();
      const modalBoardBox = await page
        .getByRole("main", { name: "全局任务" })
        .boundingBox();
      assert.ok(
        Math.abs(originalBoardBox.width - modalBoardBox.width) < 2,
        `Task modal must preserve board width: ${originalBoardBox.width} -> ${modalBoardBox.width}`,
      );
      const box = await modal.boundingBox();
      const metadataBox = await modal
        .locator(".rah-task-detail-metadata")
        .boundingBox();
      assert.ok(
        metadataBox.x - box.x <= 2 && box.width - metadataBox.width <= 4,
        "Task metadata divider spans the modal without inherited message padding",
      );
      assert.ok(
        box &&
          box.width <= width &&
          (width === 390 ? box.x === 0 : box.x > 100),
        JSON.stringify(box),
      );
      await modal
        .getByRole("button", { name: "操作时间线", exact: true })
        .click();
      await expect(
        modal.locator(".rah-task-detail-history-body"),
      ).toContainText("创建任务");
      await page.screenshot({
        path: join(output, `${engine}-${width}-history.png`),
      });
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await expect(card).toBeFocused();
      assert.equal(new URL(page.url()).searchParams.get("channel"), roomId);
      await card.click();
      await expect(modal).toBeVisible();
      await page.goBack();
      await expect(modal).toHaveCount(0);
      assert.equal(new URL(page.url()).searchParams.get("view"), "list");
      await page.goForward();
      await expect(modal).toBeVisible();
      await page.reload();
      await expect(modal.getByRole("heading", { name: title })).toBeVisible();
      const selectedQuery = new URL(page.url()).search;
      assert.equal(new URL(page.url()).searchParams.get("task"), taskId);
      const state = modal.locator(".rah-task-status-picker button").first();
      await expect(state).toBeEnabled();
      await state.click();
      await page.keyboard.press("Escape");
      await expect(modal).toBeVisible();
      await expect(state).toBeFocused();
      await state.click();
      await page
        .getByRole("menuitemradio", { name: "已关闭", exact: true })
        .click();
      await expect(state).toContainText("已关闭");
      await modal
        .getByRole("button", { name: "操作时间线", exact: true })
        .click();
      await expect(
        modal.locator(".rah-task-detail-history-body"),
      ).toContainText("已关闭");
      await state.click();
      await page
        .getByRole("menuitemradio", { name: "待办", exact: true })
        .click();
      await expect(state).toContainText("待办");
      const assignee = modal.getByRole("button", { name: /^任务负责人：/ });
      await expect(assignee).toBeEnabled();
      await assignee.click();
      await expect(
        page.getByPlaceholder("搜索人和 Agent", { exact: true }),
      ).toBeVisible();
      assert.equal(
        await page
          .locator(".rah-discovery-popover.is-task-assignee")
          .evaluate((e) => getComputedStyle(e).width),
        "240px",
      );
      await page
        .getByRole("menuitemradio", { name: "Alice", exact: true })
        .click();
      await expect(assignee).toContainText("Alice");
      await assignee.click();
      await page
        .getByRole("menuitemradio", { name: "sun", exact: true })
        .click();
      await expect(assignee).toContainText("sun");
      for (const status of [
        "完成",
        "待确认",
        "待办",
        "进行中",
        "已关闭",
        "待确认",
      ]) {
        await state.click();
        await page
          .getByRole("menuitemradio", { name: status, exact: true })
          .click();
        await expect(state).toContainText(status);
        await assignee.click();
        await page
          .getByRole("menuitemradio", { name: "未指派", exact: true })
          .click();
        await expect(assignee).toContainText("未指派");
        await assignee.click();
        await page
          .getByRole("menuitemradio", { name: "Alice", exact: true })
          .click();
        await expect(assignee).toContainText("Alice");
      }
      const historyToggle = modal.getByRole("button", {
        name: "操作时间线",
        exact: true,
      });
      if ((await historyToggle.getAttribute("aria-expanded")) === "true")
        await historyToggle.click();
      await assignee.click();
      await page.screenshot({
        path: join(output, `manual-task-edit-${engine}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await page.reload();
      await expect(state).toContainText("待确认");
      await expect(assignee).toContainText("Alice");
      await assignee.click();
      await page
        .getByRole("menuitemradio", { name: "未指派", exact: true })
        .click();
      await expect(assignee).toContainText("未指派");
      await modal
        .getByRole("button", { name: "操作时间线", exact: true })
        .click();
      await expect(
        modal.locator(".rah-task-detail-history-body"),
      ).toContainText("取消指派");
      const reply = modal.getByRole("textbox", { name: "Thread 回复输入框" });
      await expect(reply).toBeEnabled();
      const body = `TASK_MODAL_FAKE_FIXTURE_${engine}_${width}`;
      await reply.fill(body);
      await reply.press("Enter");
      await expect(
        modal
          .locator(".msg-text, .markdown-body, .msg-body")
          .filter({ hasText: body })
          .first(),
      ).toBeVisible();
      await page.reload();
      await expect(
        modal.locator(".msg-body").filter({ hasText: body }).first(),
      ).toBeVisible();
      await modal
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await expect(card).toBeVisible();

      // A denied/failed read is visible, and reloading after recovery succeeds.
      await page.route("**/v3/client/tasks/get", (route) =>
        route.abort("failed"),
      );
      await page.goto(fixture.origin + "/" + selectedQuery, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator(".rah-task-detail-failure")).toBeVisible();
      await page.unroute("**/v3/client/tasks/get");
      await page.reload();
      await expect(modal.getByRole("heading", { name: title })).toBeVisible();
      await modal
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      let observed;
      const reached = new Promise((resolve) => {
        observed = resolve;
      });
      await page.route("**/v3/client/tasks/get", async (route) => {
        const response = await route.fetch();
        observed();
        await held;
        await route.fulfill({ response }).catch(() => {});
      });
      await card.click();
      await reached;
      await page
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      release();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator('[data-testid="task-thread-modal"]').count(),
        0,
      );
      await page.unroute("**/v3/client/tasks/get");

      // The same shared card in a Room continues to open the ordinary Thread.
      await page.goto(
        fixture.origin +
          "/?" +
          new URLSearchParams({ room: roomId, roomTab: "tasks" }),
        { waitUntil: "domcontentloaded" },
      );
      await card.click();
      await expect(
        page.locator('[data-testid="thread-side-column"]'),
      ).toBeVisible();
      assert.equal(
        await page.locator('[data-testid="task-thread-modal"]').count(),
        0,
      );
      await page.screenshot({
        path: join(output, `${engine}-${width}-room-thread.png`),
      });
      assert.deepEqual(errors, []);
      results.push({
        engine,
        width,
        taskId,
        filters: true,
        history: true,
        closeFocus: true,
        back: true,
        reload: true,
        stateMutation: true,
        threadReply: true,
        readRecovery: true,
        lateRead: true,
        roomThread: true,
        assigneeMutation: true,
        assigneeReload: true,
        nestedEscape: true,
      });
      await context.close();
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
