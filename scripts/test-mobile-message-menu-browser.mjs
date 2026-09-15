import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-message-menu-`),
  failures = [];
try {
  for (const width of [390, 1440]) {
    const mobile = width === 390;
    const page = await browser.newPage({
      viewport: { width, height: mobile ? 844 : 900 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    page.setDefaultTimeout(10000);
    const menu = page.getByRole("menu", { name: "消息操作", exact: true });
    const baseItems = [
      "复制 Markdown",
      ...(mobile ? ["复制文本"] : []),
      "选择消息",
      "---",
    ];
    async function assertItems(tail) {
      await expect(menu.getByRole("menuitemradio")).toHaveCount(7);
      await expect(menu.locator("button:disabled")).toHaveCount(0);
      await expect
        .poll(() =>
          menu.evaluate((e) =>
            Array.from(e.children)
              .flatMap((child) =>
                child.tagName === "HR"
                  ? ["---"]
                  : child.getAttribute("role") === "menuitem"
                    ? [child.textContent.trim()]
                    : [],
              )
              .slice(1),
          ),
        )
        .toEqual([...baseItems, ...tail]);
    }
    async function request(path, data) {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    }
    async function open(message) {
      await message.scrollIntoViewIfNeeded();
      await expect(message.locator(".msg-body").first()).toHaveCSS(
        "font-size",
        "14px",
      );
      if (mobile) {
        const body = message.locator(".rah-message-markdown").first();
        const target = (await body.count()) ? body : message;
        const box = await target.boundingBox();
        assert.ok(box);
        if (process.env.RAH_UI_BROWSER !== "webkit") {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { x: box.x + 15, y: box.y + Math.min(15, box.height / 2) },
            ],
          });
          await page.waitForTimeout(650);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await cdp.detach();
        } else {
          await target.dispatchEvent("touchstart", {
            touches: [{ clientX: box.x + 15, clientY: box.y + 15 }],
          });
          await page.waitForTimeout(650);
          await target.dispatchEvent("touchend", { touches: [] });
        }
      } else await message.click({ button: "right" });
      await expect(menu).toBeVisible();
      if (mobile)
        assert.equal(
          await page.evaluate(() => window.getSelection()?.toString()),
          "",
        );
      await expect(
        menu.getByRole("menuitem", { name: "复制链接", exact: true }),
      ).toHaveCount(0);
    }
    async function check(name, fn) {
      try {
        await fn();
      } catch (e) {
        failures.push(`${width} ${name}: ${e.stack}`);
        await page.screenshot({
          path: `${evidence}/${width}-${name}-failure.png`,
        });
      }
    }
    // Use the fixture's Human-only Room: a Fake Worker otherwise claims newly
    // converted tasks while this test is asserting their menu transitions.
    await page.goto(`${fixture.origin}/?surface=tasks`);
    const card = page.locator(".rah-global-card-open").first();
    await expect(card).toBeVisible();
    const roomId = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    await page.goto(`${fixture.origin}/?room=${roomId}`);
    const composer = page.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await expect(composer).toBeEnabled();
    const text = `FAKE selection sample ${width}`;
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    let message = page
      .locator("main.channel .msg")
      .filter({ hasText: text })
      .first();
    await expect(message).toBeVisible();
    await check("room-menu", async () => {
      if (mobile) {
        await message.tap();
        await expect(message.locator(".msg-actions")).toBeHidden();
        await expect(message).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
        await expect(message).toHaveCSS("-webkit-user-select", "none");
      }
      await open(message);
      await assertItems(["打开消息列", "收藏消息", "转为任务"]);
      await expect(
        menu.getByRole("menuitem", { name: "打开消息列", exact: true }),
      ).toBeVisible();
      await expect(
        menu.getByRole("menuitem", { name: "转为任务", exact: true }),
      ).toBeVisible();
      if (mobile) {
        await menu
          .getByRole("menuitem", { name: "复制文本", exact: true })
          .click();
        const textPage = page.getByRole("dialog", {
          name: "复制文本",
          exact: true,
        });
        await expect(textPage).toBeVisible();
        await expect(textPage.locator(".msg-body")).toHaveCSS(
          "-webkit-user-select",
          "text",
        );
        await expect(textPage).toContainText(text);
        await expect(textPage).toHaveCSS("overflow-y", "hidden");
        await expect(textPage.locator(".msg-body")).toHaveCSS(
          "overflow-y",
          "auto",
        );
        const selectable = textPage.getByRole("textbox", {
          name: "消息文本",
          exact: true,
        });
        await expect(selectable).toHaveAttribute("contenteditable", "true");
        await selectable.evaluate((e) => {
          const event = new Event("touchstart", {
            bubbles: true,
            cancelable: true,
          });
          Object.defineProperty(event, "touches", {
            value: [{ clientX: 40, clientY: 100 }],
          });
          e.dispatchEvent(event);
        });
        await page.waitForTimeout(650);
        await selectable.dispatchEvent("touchend", { touches: [] });
        await expect(menu).toBeHidden();
        const allowsNativeMenu = await selectable.evaluate((e) =>
          e.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
        );
        assert.equal(
          allowsNativeMenu,
          true,
          "copy-only page must allow the native text menu",
        );
        await expect(menu).toBeHidden();
        await expect(selectable).toHaveCSS("border-top-width", "2px");
        await expect(selectable).toHaveCSS("font-size", "14px");
        assert.equal(
          await selectable.evaluate((e) => getComputedStyle(e).fontFamily),
          await message
            .locator(".msg-body")
            .first()
            .evaluate((e) => getComputedStyle(e).fontFamily),
        );
        await textPage.screenshot({
          path: `${evidence}/${width}-copy-text.png`,
        });
        await selectable.focus();
        await page.keyboard.press("ControlOrMeta+Home");
        await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Shift+ArrowRight");
        const fragment = await page.evaluate(() => getSelection()?.toString());
        assert.ok(
          fragment.length > 0 && fragment.length < text.length,
          "native caret can select a fragment rather than the whole message",
        );
        const original = await selectable.innerText();
        await page.keyboard.type("must not edit");
        await expect(selectable).toHaveText(original);
        await textPage.getByRole("button", { name: "关闭复制文本" }).click();
        await open(message);
      }
      await menu
        .getByRole("menuitem", { name: "打开消息列", exact: true })
        .click();
    });
    const thread = page.getByTestId("thread-side-column");
    await check("thread-root-reply", async () => {
      await expect(thread).toBeVisible();
      const root = thread.locator(".msg").filter({ hasText: text }).first();
      await open(root);
      await assertItems(["收藏消息", "转为任务"]);
      await expect(
        menu.getByRole("menuitem", { name: "转为任务", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      const input = thread.getByRole("textbox", {
        name: "Thread 回复输入框",
        exact: true,
      });
      await input.fill("FAKE reply for long press");
      await input.press("Enter");
      await expect(input).toHaveValue("");
      const reply = thread
        .locator(".msg")
        .filter({ hasText: "FAKE reply for long press" })
        .first();
      // Merely opening an empty discussion does not create a durable Thread.
      // Its first reply does; only then can the parent offer follow/unfollow.
      await open(root);
      await assertItems(["收藏消息", "转为任务", "取消关注消息列"]);
      await menu
        .getByRole("menuitem", { name: "取消关注消息列", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["收藏消息", "转为任务", "关注消息列"]);
      await menu
        .getByRole("menuitem", { name: "关注消息列", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["收藏消息", "转为任务", "取消关注消息列"]);
      await menu
        .getByRole("menuitem", { name: "收藏消息", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["从收藏中移除", "转为任务", "取消关注消息列"]);
      await menu
        .getByRole("menuitem", { name: "从收藏中移除", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(reply);
      await assertItems(["收藏消息"]);
      await menu
        .getByRole("menuitem", { name: "选择消息", exact: true })
        .click();
      const bar = page.getByRole("region", { name: "消息选择工具栏" }); // section has an accessible name
      await expect(bar).toBeVisible();
      await expect(
        page.getByRole("region", { name: "消息选择工具栏" }),
      ).toHaveCount(1);
      await expect(bar).toHaveCSS("background-color", "rgb(255, 212, 64)");
      await expect(bar.getByRole("button", { name: "复制链接" })).toHaveCount(
        0,
      );
      await expect(
        bar.getByRole("button", { name: "转发", exact: true }),
      ).toHaveCount(0);
      await expect(reply.locator("input[type=checkbox]")).toBeChecked();
      if (!mobile) {
        await bar.getByRole("button", { name: "生成图片" }).click();
        const preview = page.getByRole("dialog", {
          name: "分享预览",
          exact: true,
        });
        await expect(preview.getByAltText("所选消息图片")).toBeVisible({
          timeout: 30000,
        });
        assert.equal(
          await preview
            .getByAltText("所选消息图片")
            .evaluate((img) => img.naturalWidth),
          800,
        );
        await expect(
          preview.getByRole("button", { name: "复制图片" }),
        ).toBeEnabled();
        if (process.env.RAH_UI_BROWSER !== "webkit") {
          await page
            .context()
            .grantPermissions(["clipboard-read", "clipboard-write"]);
          await preview
            .getByRole("button", { name: "复制图片", exact: true })
            .click();
          await expect
            .poll(() =>
              page.evaluate(async () =>
                (await navigator.clipboard.read()).some((item) =>
                  item.types.includes("image/png"),
                ),
              ),
            )
            .toBe(true);
        }
        await page.screenshot({
          path: `${evidence}/${width}-image-preview.png`,
        });
        const download = page.waitForEvent("download");
        await preview.getByRole("link", { name: "下载", exact: true }).click();
        assert.equal((await download).suggestedFilename(), "rah-messages.png");
        await preview
          .getByRole("button", { name: "关闭分享预览", exact: true })
          .click();
      } else
        await expect(bar.getByRole("button", { name: "生成图片" })).toHaveCount(
          0,
        );
      await page.screenshot({ path: `${evidence}/${width}-selection.png` });
      await bar.getByRole("button", { name: "取消", exact: true }).click();
      await open(root);
      await menu
        .getByRole("menuitem", { name: "转为任务", exact: true })
        .click();
      await expect(root.getByTestId("message-task-badge")).toBeVisible();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["收藏消息", "取消关注消息列", "---", "标记为完成"]);
      await page.screenshot({
        path: `${evidence}/${width}-before-complete.png`,
      });
      await menu
        .getByRole("menuitem", { name: "标记为完成", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["收藏消息", "取消关注消息列", "---", "重新打开任务"]);
      await menu
        .getByRole("menuitem", { name: "重新打开任务", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(root);
      await assertItems(["收藏消息", "取消关注消息列", "---", "标记为完成"]);
      await page.keyboard.press("Escape");
      await open(reply);
      await assertItems(["收藏消息"]);
      await page.keyboard.press("Escape");
      await page.goto(`${fixture.origin}/?room=${roomId}`);
      await open(message);
      await assertItems([
        "打开消息列",
        "收藏消息",
        "取消关注消息列",
        "---",
        "标记为完成",
      ]);
      await menu
        .getByRole("menuitem", { name: "标记为完成", exact: true })
        .click();
      await expect(menu).toBeHidden();
      await open(message);
      await assertItems([
        "打开消息列",
        "收藏消息",
        "取消关注消息列",
        "---",
        "重新打开任务",
      ]);
      await page.keyboard.press("Escape");
    });
    await check("task-status-matrix", async () => {
      await page.goto(`${fixture.origin}/?room=${roomId}`);
      const sourceMessageId = await message.getAttribute("data-message-id");
      const { tasks } = await request("tasks/list", { roomId });
      const task = tasks.find((t) => t.sourceMessageId === sourceMessageId);
      assert.ok(task);
      for (const [workflowStatus, label] of [
        ["todo", "标记为完成"],
        ["in_progress", "标记为完成"],
        ["in_review", "标记为完成"],
        ["done", "重新打开任务"],
        ["closed", "标记为完成"],
      ]) {
        const { latestRoomSeq } = await request("rooms/sync", {
          roomId,
          consumerId: `menu-matrix-${width}`,
          bootstrap: "latest",
        });
        await request("tasks/workflow", {
          taskId: task.taskId,
          basedOnRoomSeq: latestRoomSeq,
          workflowStatus,
          idempotencyKey: `menu-matrix-${width}-${workflowStatus}`,
        });
        await page.reload();
        await open(message);
        await assertItems([
          "打开消息列",
          "收藏消息",
          "取消关注消息列",
          "---",
          label,
        ]);
        await menu
          .getByRole("menuitem", { name: "打开消息列", exact: true })
          .click();
        const root = thread.locator(".rah-thread-parent .msg");
        await open(root);
        await assertItems(["收藏消息", "取消关注消息列", "---", label]);
        await page.screenshot({
          path: `${evidence}/${width}-thread-${workflowStatus}-menu.png`,
        });
        if (workflowStatus === "closed") {
          const receipt = page.waitForResponse((response) =>
            response.url().endsWith("/tasks/workflow"),
          );
          await menu
            .getByRole("menuitem", { name: "标记为完成", exact: true })
            .click();
          const response = await receipt;
          assert.equal(response.status(), 200);
          const result = await response.json();
          assert.equal(result.task.state, "completed");
          assert.deepEqual(result.activationIds, []);
          await expect(menu).toBeHidden();
          await open(root);
          await assertItems([
            "收藏消息",
            "取消关注消息列",
            "---",
            "重新打开任务",
          ]);
        }
        await page.keyboard.press("Escape");
        const reply = thread
          .locator(".msg")
          .filter({ hasText: "FAKE reply for long press" })
          .first();
        await open(reply);
        await assertItems(["收藏消息"]);
        await page.keyboard.press("Escape");
        await page.goto(`${fixture.origin}/?room=${roomId}`);
      }
    });
    if (!mobile)
      await check("agent-export", async () => {
        await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
        const composer = page.getByRole("textbox", {
          name: "消息输入框",
          exact: true,
        });
        await expect(composer).toBeEnabled();
        await composer.fill("FAKE agent menu and export verification");
        await composer.press("Enter");
        const agentMessage = page
          .locator("main.channel .msg")
          .filter({ has: page.locator(".rah-message-sender") })
          .last();
        await expect(agentMessage).toBeVisible({ timeout: 15000 });
        await open(agentMessage);
        await menu
          .getByRole("menuitem", { name: "选择消息", exact: true })
          .click();
        await page
          .getByRole("region", { name: "消息选择工具栏" })
          .getByRole("button", { name: "生成图片" })
          .click();
        const preview = page.getByRole("dialog", {
          name: "分享预览",
          exact: true,
        });
        await expect(preview.getByAltText("所选消息图片")).toBeVisible({
          timeout: 30000,
        });
        await expect(
          preview.locator(".rah-message-image-source .rah-agent-avatar"),
        ).toHaveCount(1);
        await preview
          .getByRole("button", { name: "关闭分享预览", exact: true })
          .click();
        await page
          .getByRole("region", { name: "消息选择工具栏" })
          .getByRole("button", { name: "取消", exact: true })
          .click();
      });
    await check("dm-menu", async () => {
      await page.goto(fixture.origin);
      const dm = page
        .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
        .first();
      await dm.click();
      await expect(page.locator(".rah-direct-title")).toBeVisible();
      const input = page.getByRole("textbox", {
        name: "消息输入框",
        exact: true,
      });
      await expect(input).toBeEnabled();
      await expect(input).toHaveAttribute("placeholder", /@/);
      const dmText = `FAKE direct message menu ${width}`;
      await input.fill(dmText);
      await input.press("Enter");
      await expect(input).toHaveValue("");
      const dmMessage = page
        .locator("main.channel .msg")
        .filter({ hasText: dmText })
        .first();
      await expect(dmMessage).toBeVisible();
      await open(dmMessage);
      await assertItems(["打开消息列", "收藏消息", "转为任务"]);
      await expect(
        menu.getByRole("menuitem", { name: "收藏消息", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      if (mobile) {
        await dmMessage.tap();
        await expect(dmMessage.locator(".msg-actions")).toBeHidden();
      }
      await open(dmMessage);
      await menu
        .getByRole("menuitem", { name: "打开消息列", exact: true })
        .click();
      const root = thread.locator(".rah-thread-parent .msg");
      await open(root);
      await assertItems(["收藏消息", "转为任务"]);
      await page.keyboard.press("Escape");
      const replyInput = thread.getByRole("textbox", {
        name: "Thread 回复输入框",
        exact: true,
      });
      await replyInput.fill(`FAKE DM thread reply ${width}`);
      await replyInput.press("Enter");
      await expect(replyInput).toHaveValue("");
      const reply = thread
        .locator(".msg")
        .filter({ hasText: `FAKE DM thread reply ${width}` })
        .first();
      await open(reply);
      await assertItems(["收藏消息"]);
      await page.keyboard.press("Escape");
      await open(root);
      await assertItems(["收藏消息", "转为任务", "取消关注消息列"]);
      await page.screenshot({
        path: `${evidence}/${width}-dm-thread-menu.png`,
      });
      await page.keyboard.press("Escape");
    });
    await page.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
