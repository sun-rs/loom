import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-local-help-")),
  results = [];
const options = { extraPaths: uiContractEvidenceInputPaths() };
const inputs = snapshotUiEvidenceInputs(options);
try {
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
      const page = await browser.newPage();
      await page.addInitScript(() =>
        localStorage.setItem("rah:web-push-desired:v1", "disabled"),
      );
      let copied;
      await page.exposeFunction("helpCopied", (value) => {
        copied = value;
      });
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.goto(fixture.origin + "/?surface=settings");
        const nav = page.locator(
          width === 390
            ? ".rah-settings-mobile-index"
            : ".rah-settings-navigation:not(.rah-settings-mobile-index)",
        );
        await nav.getByRole("button", { name: "文档", exact: true }).click();
        const link = page.getByRole("link", {
          name: "打开本机操作指南",
          exact: true,
        });
        await link.waitFor({ timeout: 3000 });
        const popup = page.waitForEvent("popup");
        await link.click();
        const guide = await popup;
        await guide
          .getByRole("heading", { name: "本机恢复", exact: true })
          .waitFor();
        assert.equal(new URL(guide.url()).origin, fixture.origin);
        assert.equal(
          await guide
            .getByRole("heading", { name: "首次配置 MCP", exact: true })
            .count(),
          0,
        );
        assert.equal(
          (await guide.textContent("body")).includes("managed-mcp.json"),
          false,
        );
        await guide.reload();
        await guide
          .getByRole("heading", { name: "本机恢复", exact: true })
          .waitFor();
        await guide.close();
        if (width === 390)
          await page
            .getByRole("button", { name: "返回设置", exact: true })
            .click();
        await nav.getByRole("button", { name: "反馈", exact: true }).click();
        await page.evaluate(() =>
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
              writeText: async () => {
                throw new Error("fixture clipboard denied");
              },
            },
          }),
        );
        await page.getByRole("button", { name: "复制", exact: true }).click();
        await page.getByRole("alert").waitFor({ timeout: 3000 });
        copied = undefined;
        await page.evaluate(() =>
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (value) => window.helpCopied(value) },
          }),
        );
        await page.getByRole("button", { name: "复制", exact: true }).click();
        await page
          .getByRole("button", { name: "已复制", exact: true })
          .waitFor();
        assert.equal(copied, fixture.origin + "/_rah/health");
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
        await page.goto(fixture.origin + "/?surface=computers");
        const disclosure = page.locator("details.rah-computer-recovery");
        const toggle = disclosure.locator("summary");
        await toggle.waitFor({ timeout: 3000 });
        assert.equal(await disclosure.getAttribute("open"), null);
        await toggle.click();
        assert.notEqual(await disclosure.getAttribute("open"), null);
        await disclosure
          .getByText("关闭窗口不会停止后台工作。", { exact: false })
          .waitFor();
        assert.ok(
          (await disclosure.textContent()).includes(
            "不要对同一状态目录重复启动",
          ),
        );
        await toggle.focus();
        await page.keyboard.press("Enter");
        assert.equal(await disclosure.getAttribute("open"), null);
        assert.equal(
          await toggle.evaluate((el) => el === document.activeElement),
          true,
        );
        await page.keyboard.press("Space");
        assert.notEqual(await disclosure.getAttribute("open"), null);
        await page.screenshot({
          path: join(output, `${engine}-${width}-computer-recovery.png`),
        });
        await page.reload();
        await toggle.waitFor();
        assert.equal(await disclosure.getAttribute("open"), null);
        results.push({ engine, width, status: "passed" });
      }
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(inputs, options);
  writeFileSync(
    join(output, "receipt.json"),
    JSON.stringify({ results, inputs }, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  console.log(output);
}
