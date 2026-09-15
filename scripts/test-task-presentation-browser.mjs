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
const evidence = mkdtempSync(`${tmpdir()}/rah-task-presentation-`);
const failures = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: "Keep the Room-first delivery contract" })
      .first();
    await expect(card).toBeVisible();
    const { roomId, taskId } = await card.evaluate((el) => ({
      roomId: el.closest("[data-task-room-id]").dataset.taskRoomId,
      taskId: el.closest("[data-task-id]").dataset.taskId,
    }));
    const roomUrl = `${fixture.origin}/?room=${roomId}`;
    async function check(name, fn) {
      try {
        await fn();
      } catch (error) {
        await page.screenshot({
          path: `${evidence}/${width}-${name.replaceAll(" ", "-")}-failure.png`,
        });
        failures.push(`${width} ${name}: ${error.message}`);
      }
    }
    await check("room creation", async () => {
      await page.goto(roomUrl + "&roomTab=tasks");
      const trigger = page.getByRole("button", {
        name: "新建任务",
        exact: true,
      });
      await expect(trigger).toHaveText(width === 390 ? "新建任务" : "新建");
      await expect(trigger).toHaveCSS("box-shadow", "none");
      await expect
        .poll(() =>
          page.evaluate(() => {
            const button = document.querySelector(".rah-task-create");
            const filter = document.querySelector(
              ".tasks-toolbar .task-filter .task-filter-trigger",
            );
            if (!button || !filter) return false;
            const a = getComputedStyle(button),
              b = getComputedStyle(filter);
            return (
              a.borderTopWidth === "2px" &&
              a.borderTopWidth === b.borderTopWidth &&
              a.borderTopStyle === b.borderTopStyle &&
              a.borderTopColor === b.borderTopColor
            );
          }),
        )
        .toBe(true);
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "创建任务",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("配置负责人与依赖")).toHaveCount(0);
      if (width === 390)
        await expect(
          dialog.getByRole("textbox", { name: "任务 1", exact: true }),
        ).toHaveCSS("font-size", "16px");
      const box = await dialog.boundingBox();
      assert.ok(box.x > 0 && box.y > 0 && box.width <= 448 && box.height < 700);
      await dialog
        .getByRole("textbox", { name: "任务 1", exact: true })
        .fill("FAKE title-only fixture");
      await page.screenshot({ path: `${evidence}/${width}-create.png` });
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/tasks/create") && r.request().method() === "POST",
      );
      await dialog
        .getByRole("button", { name: "创建任务", exact: true })
        .click();
      const accepted = await response;
      assert.equal(accepted.status(), 200);
      const task = (await accepted.json()).task;
      assert.equal(task.assigneeId, undefined);
      assert.deepEqual(task.dependencyTaskIds, []);
      await expect(dialog).toBeHidden();
    });
    await check("room approval", async () => {
      await page.goto(roomUrl + "&roomTab=tasks");
      await page
        .locator(`[data-task-id="${taskId}"] .rah-global-card-open`)
        .click();
      const modal = page.getByTestId("task-thread-modal");
      await expect(modal).toBeVisible();
      await expect(modal.getByTestId("task-detail-metadata")).toBeVisible();
      const back = modal.getByRole("button", {
        name: "返回任务页面",
        exact: true,
      });
      const close = modal.getByRole("button", {
        name: "关闭任务详情",
        exact: true,
      });
      await expect(width === 390 ? back : close).toBeVisible();
      await expect(width === 390 ? close : back).toBeHidden();
      await page.screenshot({ path: `${evidence}/${width}-approval.png` });
      await (width === 390 ? back : close).click();
      await expect(page.locator(".tasks-toolbar")).toBeVisible();
    });
    await check("badge overlay preserves background width", async () => {
      await page.goto(roomUrl + "&roomTab=chat");
      const badge = page.getByTestId("message-task-badge").first();
      await expect(badge).toBeVisible();
      const before = await page.locator("main.channel").boundingBox();
      await badge.click();
      await expect(page.getByTestId("task-thread-modal")).toBeVisible();
      if (width === 1440)
        assert.deepEqual(
          await page.locator("main.channel").boundingBox(),
          before,
        );
      await page.screenshot({ path: `${evidence}/${width}-badge.png` });
    });
    await check("message toolbar", async () => {
      await page.mouse.move(0, 0);
      await page.goto(roomUrl + "&roomTab=chat");
      const msg = page
        .locator(".msg")
        .filter({ has: page.locator(".msg-actions") })
        .first();
      const actions = msg.locator(".msg-actions");
      await expect(actions).toHaveCSS("opacity", "0");
      if (width === 390) await msg.locator(".msg-head").tap();
      else await msg.hover();
      if (width === 390) await expect(actions).toBeHidden();
      else await expect(actions).toHaveCSS("opacity", "1");
      await expect(actions.locator("button").first()).toHaveCSS(
        "color",
        "rgba(0, 0, 0, 0.5)",
      );
      await page.screenshot({
        path: `${evidence}/${width}-message-actions.png`,
      });
      if (width === 390) await page.locator("main.channel > header").tap();
      else await page.mouse.move(width - 5, 5);
      await expect(actions).toHaveCSS("opacity", "0");
    });

    for (const surface of ["thread", "task", "dm"])
      await check(`${surface} toolbar`, async () => {
        await page.mouse.move(0, 0);
        await page.goto(roomUrl + "&roomTab=chat");
        let container;
        let composerName;
        if (surface === "dm") {
          const key = await page
            .locator('[data-sidebar-group="dms"] [data-sidebar-key]')
            .first()
            .getAttribute("data-sidebar-key");
          assert.ok(key);
          if (width === 390)
            await page
              .getByRole("button", { name: "返回主页", exact: true })
              .tap();
          await page
            .locator(`[data-sidebar-key="${key}"] button`)
            .first()
            .click();
          container = page.locator("main.channel");
          composerName = "消息输入框";
        } else {
          if (surface === "task") {
            await page.goto(roomUrl + "&roomTab=tasks");
            await page
              .locator(`[data-task-id="${taskId}"] .rah-global-card-open`)
              .click();
          } else {
            const roomInput = page.getByRole("textbox", {
              name: "消息输入框",
              exact: true,
            });
            await expect(roomInput).toBeEnabled();
            const rootText = `FAKE stable thread root ${width}`;
            await roomInput.fill(rootText);
            await roomInput.press("Enter");
            await expect(roomInput).toHaveValue("");
            const msg = page
              .locator("main.channel .msg")
              .filter({ hasText: rootText })
              .first();
            await expect(msg).toBeVisible();
            await msg.locator(".msg-head").click({ button: "right" });
            await page
              .getByRole("menuitem", { name: "打开消息列", exact: true })
              .click();
            await expect(page.getByTestId("task-thread-modal")).toHaveCount(0);
          }
          container =
            surface === "task"
              ? page.getByTestId("task-thread-modal")
              : page.getByTestId("thread-side-column");
          composerName = "Thread 回复输入框";
        }
        const text = `FAKE toolbar fixture ${surface} ${width}`;
        const composer = container.getByRole("textbox", {
          name: composerName,
          exact: true,
        });
        if (surface === "dm") {
          await expect(container.locator(".rah-direct-title")).toBeVisible();
          await expect(composer).toHaveAttribute("placeholder", /@/);
        }
        await expect(composer).toBeEnabled();
        await composer.fill(text);
        await composer.press("Enter");
        const message = container
          .locator(".msg")
          .filter({ hasText: text })
          .last();
        const actions = message.locator(".msg-actions");
        await expect(actions).toHaveCSS("opacity", "0");
        if (width === 390) await message.locator(".msg-head").tap();
        else await message.hover();
        if (width === 390) await expect(actions).toBeHidden();
        else await expect(actions).toHaveCSS("opacity", "1");
        await page.screenshot({
          path: `${evidence}/${width}-${surface}-actions.png`,
        });
        if (width === 390 && surface === "task") {
          const body = message.locator(".rah-message-markdown").first();
          const box = await body.boundingBox();
          assert.ok(box);
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: box.x + 12, y: box.y + 8 }],
          });
          await page.waitForTimeout(650);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await cdp.detach();
          const menu = page.getByRole("menu", {
            name: "消息操作",
            exact: true,
          });
          await expect(menu).toBeVisible();
          await menu
            .getByRole("menuitem", { name: "复制文本", exact: true })
            .click();
          const textPage = page.getByRole("dialog", {
            name: "复制文本",
            exact: true,
          });
          await expect(textPage).toContainText(text);
          await textPage.getByRole("button", { name: "关闭复制文本" }).click();
        }
        if (width === 390) await composer.tap();
        else await page.mouse.move(0, 0);
        await expect(actions).toHaveCSS("opacity", "0");
      });
    await context.close();
  }
  console.log(evidence);
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ evidence, status: "passed" }));
} finally {
  await browser.close();
  await fixture.close();
}
