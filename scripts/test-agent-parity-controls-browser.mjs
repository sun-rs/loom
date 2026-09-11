import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({
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
    for (const mode of ["header", "create", "runtime", "reminder", "reset"]) {
      try {
        await page.goto(origin + "?mode=" + mode);
        if (mode === "header") {
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
            await page.getByText("3/3000", { exact: true }).count(),
            1,
            "live description count",
          );
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
