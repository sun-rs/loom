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
        if (mode === "profile-fields") {
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
            .locator(".rah-agent-create-dialog label")
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
          await page.getByLabel("推理强度", { exact: true }).waitFor();
          assert.equal(
            await page.getByText("高级", { exact: true }).count(),
            0,
          );
          assert.equal(
            await page.getByText("Handle", { exact: true }).count(),
            0,
          );
          await page.getByPlaceholder("例如 Alice").fill("Alice");
          await page
            .getByRole("combobox", { name: /运行时/ })
            .selectOption("fixture-offer");
          await page
            .getByRole("combobox", { name: /^模型/ })
            .selectOption("sonnet");
          await page
            .getByLabel("推理强度", { exact: true })
            .selectOption("high");
          await page
            .getByLabel("提供方", { exact: true })
            .selectOption("custom");
          await page
            .getByLabel("API 地址", { exact: true })
            .fill("https://example.invalid");
          await page
            .getByLabel("API 密钥", { exact: true })
            .fill("fixture-only-key");
          await page.getByText("更多", { exact: true }).click();
          await page.getByRole("button", { name: "添加变量" }).click();
          await page
            .getByLabel("环境变量名称 3", { exact: true })
            .fill("EXAMPLE_FLAG");
          await page.getByLabel("环境变量值 3", { exact: true }).fill("yes");
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
          assert.equal(await page.getByRole("radio").nth(1).isChecked(), true);
          await page.keyboard.press("ArrowUp");
          assert.equal(await radio.isChecked(), true);
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
          const effort = page.getByRole("button", { name: /^推理强度：/ });
          assert.equal(await effort.isVisible(), true, "effort always visible");
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
