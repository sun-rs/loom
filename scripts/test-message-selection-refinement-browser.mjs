import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture();
const browser = await chromium.launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-selection-refinement-`);
const failures = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    async function check(name, fn) {
      try {
        await fn();
      } catch (error) {
        failures.push(`${width} ${name}: ${error}`);
      }
    }
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page.locator(".rah-global-card-open").first();
    await expect(card).toBeVisible();
    const room = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    await page.goto(`${fixture.origin}/?room=${room}`);
    const message = page
      .locator("main.channel .msg")
      .filter({ has: page.getByTestId("message-task-badge") })
      .first();
    await expect(message).toBeVisible();
    await check("action-icon-alignment", async () => {
      if (width === 390) return;
      await message.hover();
      const icons = message.locator(".msg-actions button > svg");
      const centers = await icons.evaluateAll((es) =>
        es
          .filter((e) => e.getBoundingClientRect().height > 0)
          .map((e) => {
            const rect = e.getBoundingClientRect();
            return rect.y + rect.height / 2;
          }),
      );
      assert.ok(centers.length >= 2);
      assert.ok(Math.max(...centers) - Math.min(...centers) < 1);
      await message.screenshot({
        path: `${evidence}/desktop-action-icons.png`,
      });
    });
    await message.locator(".msg-head time").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "消息操作", exact: true });
    await expect(menu).toBeVisible();
    await page.screenshot({ path: `${evidence}/${width}-menu.png` });
    await check("menu", async () => {
      await expect(menu).toHaveCSS(
        "box-shadow",
        "oklch(0.18 0.006 25) 4px 4px 0px 0px",
      );
      assert.ok(
        await menu
          .getByRole("menuitem", { name: "标记为完成", exact: true })
          .evaluate(
            (e) =>
              e.previousElementSibling?.tagName === "HR" &&
              !e.nextElementSibling,
          ),
      );
    });
    await menu.getByRole("menuitem", { name: "选择消息", exact: true }).click();
    const bar = page.getByRole("region", { name: "消息选择工具栏" });
    await expect(bar).toBeVisible();
    await check("select-all-icon", async () => {
      const all = bar.getByRole("button", { name: "全选", exact: true });
      await expect(all.locator("svg use")).toHaveAttribute(
        "href",
        /#raft-icon-list-checks$/,
      );
    });
    await check("touch-toolbar-spacing", async () => {
      if (width !== 390) return;
      const actions = bar.locator(":scope > div");
      await expect(actions).toHaveCSS("column-gap", "8px");
      for (const size of [390, 320, 240, 390]) {
        await bar.evaluate((e, size) => (e.style.width = `${size}px`), size);
        await page.waitForTimeout(150);
        const rects = await actions
          .locator("button")
          .evaluateAll((es) =>
            es.map((e) => e.getBoundingClientRect().toJSON()),
          );
        for (let i = 1; i < rects.length; i++) {
          // A 4px hover shadow must still leave 4px of visible separation.
          assert.ok(rects[i].left - rects[i - 1].right >= 8);
          assert.equal(rects[i].top, rects[0].top);
        }
        const bounds = await bar.boundingBox();
        assert.ok(rects.at(-1).right + 4 <= bounds.x + bounds.width);
        await bar.screenshot({ path: `${evidence}/touch-toolbar-${size}.png` });
      }
      await bar.evaluate((e) => e.style.removeProperty("width"));
    });
    await check("toolbar-font", async () => {
      await expect(
        bar.getByRole("button", { name: "取消", exact: true }),
      ).toHaveCSS("font-size", "12px");
    });
    await check("approval-preserves-selection", async () => {
      await message.getByTestId("message-task-badge").click();
      const dialog = page.getByTestId("task-thread-modal");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(700);
      await dialog.getByRole("button", { name: /关闭/ }).first().click();
      await expect(bar).toBeVisible();
      await expect(message.locator("input[type=checkbox]")).toBeChecked();
    });
    if (await bar.isVisible()) {
      await check("button-motion", async () => {
        if (width === 390) return;
        const button = bar.getByRole("button", { name: "取消", exact: true });
        await button.hover();
        await expect(button).toHaveCSS(
          "background-color",
          "rgb(255, 255, 255)",
        );
        await expect(button).toHaveCSS(
          "transform",
          "matrix(1, 0, 0, 1, 0, -1)",
        );
        const hoverShadow = await button.evaluate(
          (e) => getComputedStyle(e).boxShadow,
        );
        await page.mouse.down();
        await expect(button).toHaveCSS("transform", "matrix(1, 0, 0, 1, 1, 1)");
        await expect(button).toHaveCSS("box-shadow", hoverShadow);
        await page.mouse.move(0, 0);
        await page.mouse.up();
      });
      await check("compact", async () => {
        if (width === 390) return;
        for (const size of [480, 360, 290, 240, 480]) {
          await bar.evaluate((e, size) => {
            e.style.width = `${size}px`;
          }, size);
          await page.waitForTimeout(150);
          const flags = await bar
            .locator("button")
            .evaluateAll((es) =>
              es.map(
                (e) =>
                  e.querySelector("span")?.getBoundingClientRect().width > 0,
              ),
            );
          assert.deepEqual(
            [...flags].sort((a, b) => Number(b) - Number(a)),
            flags,
          );
          const rects = await bar
            .locator("button")
            .evaluateAll((es) =>
              es.map((e) => e.getBoundingClientRect().toJSON()),
            );
          assert.ok(rects.every((r) => r.y === rects[0].y));
          assert.ok(rects.at(-1).right <= (await bar.boundingBox()).x + size);
          if (size === 240) assert.ok(flags.some((f) => !f));
          await bar.screenshot({ path: `${evidence}/toolbar-${size}.png` });
        }
        await bar.evaluate((e) => e.style.removeProperty("width"));
      });
      await page.screenshot({ path: `${evidence}/${width}-selection.png` });
      await check("preview-width", async () => {
        if (width === 390) return;
        await bar.getByRole("button", { name: "生成图片" }).click();
        const dialog = page.getByRole("dialog", {
          name: "分享预览",
          exact: true,
        });
        const image = dialog.getByAltText("所选消息图片");
        await expect(image).toBeVisible();
        const bounds = await image.boundingBox(),
          wrap = await dialog
            .locator(".rah-message-image-scroll")
            .boundingBox();
        assert.ok(
          Math.abs(
            bounds.x - wrap.x - (wrap.x + wrap.width - bounds.x - bounds.width),
          ) < 2,
        );
        await page.screenshot({ path: `${evidence}/${width}-preview.png` });
        await dialog
          .getByRole("button", { name: "关闭分享预览", exact: true })
          .click();
      });
      await check("thread-and-navigation", async () => {
        const replyButton = message.locator(".thread-preview");
        if (await replyButton.count()) await replyButton.click();
        else {
          await bar.getByRole("button", { name: "取消", exact: true }).click();
          await message.locator(".msg-head time").click({ button: "right" });
          await menu
            .getByRole("menuitem", { name: "打开消息列", exact: true })
            .click();
        }
        const thread = page.getByTestId("thread-side-column");
        await expect(thread).toBeVisible();
        if (width === 1440 && (await replyButton.count()))
          await expect(bar).toBeVisible();
        else await expect(bar).toHaveCount(0);
        const root = thread.locator(".msg").first();
        await root.locator(".msg-head time").click({ button: "right" });
        await menu
          .getByRole("menuitem", { name: "选择消息", exact: true })
          .click();
        await root.getByTestId("message-task-badge").click();
        const dialog = page.getByTestId("task-thread-modal");
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(600);
        await dialog.getByRole("button", { name: /关闭/ }).first().click();
        await expect(
          thread.getByRole("region", { name: "消息选择工具栏" }),
        ).toBeVisible();
        await expect(root.locator("input[type=checkbox]")).toBeChecked();
      });
    }
    await check("profile-and-tab-lifecycle", async () => {
      await page.goto(`${fixture.origin}/?room=${room}`);
      await expect(message).toBeVisible();
      await message.locator(".msg-head time").click({ button: "right" });
      await menu
        .getByRole("menuitem", { name: "选择消息", exact: true })
        .click();
      await message
        .getByRole("button", { name: /^查看 .* (资料|动态)$/ })
        .first()
        .click();
      const profile = page.locator(".rah-agent-detail-panel").last();
      await expect(profile).toBeVisible();
      if (width === 1440) await expect(bar).toBeVisible();
      else await expect(bar).toHaveCount(0);
      await profile
        .getByRole("button", {
          name: width === 390 ? "返回聊天" : /关闭 .* 侧栏/,
        })
        .click();
      if (width === 1440) {
        await expect(bar).toBeVisible();
        await page.getByRole("tab", { name: "任务", exact: true }).click();
        await expect(bar).toHaveCount(0);
      } else await expect(bar).toHaveCount(0);
    });
    await page.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
