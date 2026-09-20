import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser =
  process.env.RAH_BROWSER === "webkit"
    ? await webkit.launch()
    : await chromium.launch({
        headless: true,
        executablePath: await findChromeExecutable(),
      });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  page.on("pageerror", (e) => console.error(e.message));
  const failures = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const origin =
      server.resolvedUrls.local[0] + "test/agent-parity-controls.html";
    for (const mode of process.env.RAH_AGENT_PARITY_MODE
      ? [process.env.RAH_AGENT_PARITY_MODE]
      : ["header", "create", "runtime", "reminder", "reset"]) {
      try {
        await page.goto(origin + "?mode=" + mode);
        if (["create", "runtime", "reset"].includes(mode)) {
          const dialog = page.getByRole("dialog").first();
          await dialog.waitFor();
          for (const resize of [320, 600, width]) {
            await page.setViewportSize({ width: resize, height: 844 });
            assert.equal(
              await dialog.isVisible(),
              true,
              `dialog visible at ${resize}`,
            );
            const bounds = await dialog.boundingBox();
            assert.ok(bounds.x >= 16 && bounds.x + bounds.width <= resize - 16);
            assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
          }
        }
        if (mode === "deleted-dm") {
          const rows = page.getByRole("button", {
            name: "私信 Same Agent",
            exact: true,
          });
          assert.equal(await rows.count(), 2);
          assert.equal(
            await rows
              .nth(0)
              .locator(".rah-agent-avatar")
              .evaluate((e) => getComputedStyle(e).filter),
            "grayscale(1)",
          );
          await rows.nth(0).click();
          assert.equal(await page.locator("output").textContent(), "dm-old");
          await rows.nth(1).click();
          assert.equal(await page.locator("output").textContent(), "dm-new");
          await page.reload();
          assert.equal(await rows.count(), 2);
          await page.screenshot({
            path: `/tmp/rah-deleted-dm-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
        } else if (mode === "deleted") {
          await page.evaluate(() => {
            document.documentElement.dataset.rahAgentModelName = "true";
          });
          await page.getByText("已删除", { exact: true }).waitFor();
          assert.equal(await page.locator(".rah-message-sender").count(), 0);
          const deletedName = page.locator(".msg-head b");
          assert.equal(await deletedName.textContent(), "Deleted Agent");
          assert.equal(
            await page
              .locator(".msg-head")
              .evaluate((e) => getComputedStyle(e).flexWrap),
            "nowrap",
          );
          const headerBounds = await page.locator(".msg-head").boundingBox();
          assert.ok(
            headerBounds.height <= 24,
            "message metadata remains one row at every width",
          );
          await deletedName.hover();
          assert.equal(
            await deletedName.evaluate(
              (e) => getComputedStyle(e).textDecorationLine,
            ),
            "none",
          );
          assert.equal(
            await deletedName.evaluate((e) => getComputedStyle(e).cursor),
            "default",
          );
          const avatar = page.locator(".rah-agent-avatar");
          assert.equal(
            await avatar.evaluate((e) => getComputedStyle(e).filter),
            "grayscale(1)",
          );
          assert.equal(
            await avatar.evaluate((e) => getComputedStyle(e).opacity),
            "0.6",
          );
          assert.equal(
            await avatar.locator(".rah-agent-avatar-presence").count(),
            0,
          );
          await page.getByText("Deleted Agent", { exact: true }).click();
          assert.equal(await page.locator("output").textContent(), "0");
          await page
            .getByRole("button", { name: "查看 Deleted Agent 动态" })
            .hover();
          const preview = page.locator(".rah-agent-preview");
          await preview.getByText("@deleted", { exact: true }).waitFor();
          await preview.getByText("离线", { exact: true }).waitFor();
          await preview.getByText("fixture-model", { exact: true }).waitFor();
          await preview.getByText("最近动态", { exact: true }).waitFor();
          assert.equal(
            await preview
              .locator(".rah-agent-avatar")
              .evaluate((e) => getComputedStyle(e).filter),
            "none",
          );
          await page.screenshot({
            path: `/tmp/rah-deleted-hover-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
          await page.keyboard.press("Escape");
          await page
            .getByRole("button", { name: "查看 Deleted Agent 动态" })
            .click();
          await page
            .getByText("这个 Agent 已被终止，或已不在此 Server 中可用。", {
              exact: true,
            })
            .waitFor();
          await page.waitForLoadState("networkidle");
          const panelBounds = await page
            .locator(".rah-agent-unavailable")
            .boundingBox();
          assert.ok(
            panelBounds && panelBounds.width >= Math.min(width - 10, 320),
          );
          await page.screenshot({
            path: `/tmp/rah-deleted-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
          await page.getByRole("button", { name: "关闭 Agent 详情" }).click();
          assert.equal(await page.locator(".rah-agent-unavailable").count(), 0);
          await page.reload();
          await page.getByText("已删除", { exact: true }).waitFor();
        } else if (mode === "profile-fields") {
          await page
            .getByRole("button", { name: "编辑显示名称", exact: true })
            .click();
          await page
            .getByRole("button", { name: "编辑描述", exact: true })
            .click();
          const name = page.getByRole("textbox", {
            name: "显示名称",
            exact: true,
          });
          const description = page.getByRole("textbox", {
            name: "描述",
            exact: true,
          });
          assert.equal((await name.boundingBox()).height, 32);
          assert.equal((await description.boundingBox()).height, 40);
          assert.equal(
            await description.evaluate((e) => getComputedStyle(e).resize),
            "none",
          );
          const save = page
            .getByRole("button", { name: "保存", exact: true })
            .first();
          assert.equal(
            await save.evaluate((e) => getComputedStyle(e).fontSize),
            "12px",
          );
          assert.equal((await save.boundingBox()).height, 28);
          await page.screenshot({
            path: `/tmp/rah-profile-fields-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
          await description.fill(Array(20).fill("line").join("\n"));
          assert.equal((await description.boundingBox()).height, 160);
          await description.fill("short");
          assert.equal((await description.boundingBox()).height, 40);
          await description.press("Escape");
          await page
            .getByRole("button", { name: "编辑描述", exact: true })
            .waitFor();
          await name.fill("Changed Agent");
          await name.press("Enter");
          await page
            .getByRole("button", { name: "编辑显示名称", exact: true })
            .waitFor();
          assert.equal(await page.locator("output").textContent(), "1");
        } else if (mode === "header") {
          const button = page.getByRole("button", {
            name: "给 Fixture Agent 发消息",
          });
          await button.waitFor({ state: "attached" });
          assert.equal(
            await button.isVisible(),
            true,
            "desktop header DM action visible",
          );
          await button.click();
          assert.equal(await page.locator("output").textContent(), "1");
        } else if (mode === "create") {
          await page.getByRole("dialog").waitFor();
          const dialog = page.getByRole("dialog");
          assert.equal(
            await dialog.evaluate((e) => getComputedStyle(e).alignSelf),
            "center",
          );
          assert.equal(
            await dialog
              .locator("select")
              .first()
              .evaluate((e) => getComputedStyle(e).appearance),
            "none",
          );
          assert.equal(
            await dialog.evaluate((e) => getComputedStyle(e).padding),
            "24px",
          );
          assert.equal(
            await dialog
              .locator("header")
              .evaluate((e) => getComputedStyle(e).borderBottomWidth),
            "0px",
          );
          assert.equal(
            await dialog
              .locator("h2")
              .evaluate((e) => getComputedStyle(e).fontSize),
            "18px",
          );
          assert.equal(
            await dialog
              .locator("form")
              .evaluate((e) => getComputedStyle(e).padding),
            "0px",
          );
          assert.equal(
            await dialog
              .locator("footer")
              .evaluate((e) => getComputedStyle(e).position),
            "static",
          );
          assert.equal(
            await dialog
              .locator("footer")
              .evaluate((e) => getComputedStyle(e).borderTopWidth),
            "0px",
          );
          assert.equal(
            await dialog
              .locator("select")
              .first()
              .evaluate((e) => getComputedStyle(e).fontSize),
            "16px",
          );
          assert.equal(
            await dialog
              .locator(".rah-agent-description-count")
              .evaluate((e) => getComputedStyle(e).textAlign),
            "right",
          );
          const labels = await page
            .locator(
              ".rah-agent-create-dialog label, .rah-agent-create-dialog .rah-runtime-edit-field > b",
            )
            .evaluateAll((labels) =>
              labels
                .filter((l) => l.querySelector("em"))
                .map((l) => {
                  const em = l.querySelector("em");
                  const caption = em.parentElement;
                  return (
                    caption.tagName !== "LABEL" &&
                    Math.abs(
                      em.getBoundingClientRect().top -
                        caption.getBoundingClientRect().top,
                    ) < 4
                  );
                }),
            );
          assert.ok(
            labels.length >= 3 && labels.every(Boolean),
            "required markers share caption line",
          );
          const inputStyle = await page
            .locator(".rah-agent-create-dialog input")
            .first()
            .evaluate((e) => ({
              size: getComputedStyle(e).fontSize,
              line: getComputedStyle(e).lineHeight,
              pad: getComputedStyle(e).padding,
            }));
          assert.deepEqual(inputStyle, {
            size: "16px",
            line: "24px",
            pad: "8px 12px",
          });
          const textarea = page.locator("textarea").first();
          await textarea.fill("abc");
          assert.equal(
            await page.getByText("3/2000", { exact: true }).count(),
            1,
            "live description count",
          );
          await page.screenshot({
            path: `/tmp/rah-create-agent-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
          await page.getByRole("button", { name: /^推理强度：/ }).waitFor();
          assert.equal(
            await page.getByText("高级", { exact: true }).count(),
            0,
          );
          assert.equal(
            await page.getByText("Handle", { exact: true }).count(),
            0,
          );
          await page.getByPlaceholder("例如 Alice").fill("Alice");
          for (const [label, option] of [
            ["运行时", /Claude/],
            ["模型", /Sonnet/i],
            ["推理强度", /High/i],
          ]) {
            const trigger = page.getByRole("button", {
              name: new RegExp(`^${label}：`),
            });
            await trigger.click();
            const menu = page.getByRole("menu", { name: `${label}筛选` });
            assert.equal(
              (await menu.boundingBox()).width,
              (await trigger.boundingBox()).width,
            );
            assert.deepEqual(
              await trigger.evaluate((e) => ({
                font: getComputedStyle(e).fontSize,
                weight: getComputedStyle(e).fontWeight,
                border: getComputedStyle(e).borderTopWidth,
              })),
              { font: "16px", weight: "400", border: "2px" },
            );
            await menu.getByRole("menuitemradio", { name: option }).click();
          }
          assert.equal(
            await page.getByLabel("提供方", { exact: true }).count(),
            0,
          );
          await page.getByText("更多", { exact: true }).click();
          await page.getByRole("button", { name: "添加变量" }).click();
          await page
            .getByLabel("环境变量名称 1", { exact: true })
            .fill("EXAMPLE_FLAG");
          await page.getByLabel("环境变量值 1", { exact: true }).fill("yes");
          await page.screenshot({
            path: `/tmp/rah-create-configured-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
          });
          await page
            .getByRole("button", { name: "创建 Agent", exact: true })
            .click();
          await page
            .getByRole("alert")
            .filter({ hasText: "Fixture environment failure" })
            .waitFor();
          assert.equal(
            await page.getByPlaceholder("例如 Alice").isDisabled(),
            true,
          );
          await page
            .getByRole("button", { name: "重试保存配置", exact: true })
            .click();
          await page.getByText("Fixture closed").waitFor();
        } else if (mode === "reset") {
          const dialog = page.getByRole("dialog");
          await dialog.waitFor();
          if (width === 1280)
            assert.equal((await dialog.boundingBox()).width, 448);
          assert.equal(
            await dialog.evaluate((e) => getComputedStyle(e).padding),
            "24px",
          );
          assert.equal(
            await dialog
              .locator("header")
              .evaluate((e) => getComputedStyle(e).borderBottomWidth),
            "0px",
          );
          assert.match(
            await dialog.evaluate((e) => getComputedStyle(e).boxShadow),
            /4px 4px 0px/,
          );
          const radio = page.getByRole("radio").first();
          for (const button of await dialog.locator("footer button").all()) {
            assert.equal((await button.boundingBox()).height, 28);
          }
          const close = dialog.getByRole("button", {
            name: "关闭",
            exact: true,
          });
          assert.equal((await close.boundingBox()).width, 32);
          assert.equal((await close.locator("svg").boundingBox()).width, 20);
          assert.ok((await radio.boundingBox()).width <= 1);
          await page.locator(".rah-agent-reset-option").nth(1).click();
          assert.equal(
            await page.getByRole("radio").nth(1).isChecked(),
            true,
            "pointer selects session reset",
          );
          // WebKit does not focus radio inputs on a pointer click by default.
          await page.getByRole("radio").nth(1).focus();
          await page.keyboard.press("ArrowUp");
          assert.equal(
            await radio.isChecked(),
            true,
            "ArrowUp selects restart",
          );
          await page.keyboard.press("Escape");
          await page.getByText("Fixture closed").waitFor();
        } else if (mode === "reminder") {
          await page.getByText("暂无提醒", { exact: true }).waitFor();
          const title = page.getByText("暂无提醒", { exact: true });
          assert.equal(
            await title.evaluate((e) => getComputedStyle(e).fontSize),
            "18px",
          );
          const icon = page.locator(".rah-agent-reminders-pane svg");
          assert.equal((await icon.boundingBox()).width, 28);
          const desc = page.getByText(/此 Agent 尚未安排任何提醒/);
          assert.equal(
            await desc.evaluate((e) => getComputedStyle(e).fontSize),
            "14px",
          );
        } else {
          await page.getByRole("dialog").waitFor();
          const dialog = page.getByRole("dialog");
          assert.equal(
            (await dialog.boundingBox()).width,
            Math.min(448, width - 32),
          );
          assert.equal(
            await dialog
              .locator("form")
              .evaluate((e) => getComputedStyle(e).padding),
            "0px",
          );
          const heading = await dialog.locator("header h2").boundingBox();
          const field = await dialog
            .locator(".rah-runtime-edit-field")
            .first()
            .boundingBox();
          assert.equal(field.x, heading.x);
          const effort = page.getByRole("button", { name: /^推理强度：/ });
          assert.equal(await effort.isVisible(), true, "effort always visible");
          for (const label of ["运行时", "模型", "推理强度"]) {
            const trigger = page.getByRole("button", {
              name: new RegExp(`^${label}：`),
            });
            await trigger.click();
            const menu = page.getByRole("menu", { name: `${label}筛选` });
            assert.equal(
              (await menu.boundingBox()).width,
              (await trigger.boundingBox()).width,
            );
            if (label === "模型")
              await page.screenshot({
                path: `/tmp/rah-runtime-menu-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
              });
            await page.keyboard.press("Escape");
            assert.equal(await dialog.isVisible(), true);
            assert.equal(
              await trigger.evaluate((e) => e === document.activeElement),
              true,
            );
          }
          assert.equal(
            await page
              .getByRole("button", { name: "高级", exact: true })
              .count(),
            0,
          );
          await page.keyboard.press("Escape");
          await page.getByText("Fixture closed").waitFor();
        }
        console.log({ width, mode, passed: true });
      } catch (error) {
        failures.push(`${width} ${mode}: ${error.message}`);
      }
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await server.close();
}
