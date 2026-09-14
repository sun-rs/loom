import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { readyComposer } from "./composer-drop-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-file-types-"));
const options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
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
      page.setDefaultTimeout(15000);
      await page.addInitScript(() =>
        localStorage.setItem("rah:web-push-desired:v1", "disabled"),
      );
      const post = async (path, data) => {
        const r = await page.request.post(
          fixture.origin + "/v3/client/" + path,
          { data },
        );
        assert.equal(r.status(), 200, await r.text());
        return r.json();
      };
      const workspace = (await post("workspaces/list", {})).workspaces[0];
      const head = (
        await post("rooms/sync", {
          roomId: workspace.controlRoomId,
          consumerId: "file-gate",
          bootstrap: "latest",
          limit: 1,
        })
      ).latestRoomSeq;
      const room = (
        await post("rooms/create", {
          workspaceId: workspace.workspaceId,
          kind: "channel",
          name: "File types fixture",
          slug: "file-types-fixture",
          visibility: "private",
          basedOnControlRoomSeq: head,
          idempotencyKey: crypto.randomUUID(),
        })
      ).room;
      await page.goto(fixture.origin + "/?room=" + room.roomId);
      const form = await readyComposer(page, "消息输入框");
      const cases = [
        {
          name: "sample.md",
          mime: "text/markdown",
          text:
            "# Markdown fixture\n\n**bold fixture**\n\n" +
            "Document paragraph.\n\n".repeat(50) +
            "## Final section\n\nEnd.",
          kind: "markdown",
        },
        {
          name: "sample.html",
          mime: "text/html",
          text: "<h1>HTML fixture</h1><script>parent.__previewExecuted=true</script>",
          kind: "html",
        },
        {
          name: "sample.csv",
          mime: "text/csv",
          text: 'name,value\n"comma,value",2\n',
          kind: "csv",
        },
        {
          name: "sample.diff",
          mime: "text/x-diff",
          text: "--- old\n+++ new\n-old fixture\n+new fixture\n",
          kind: "diff",
        },
        {
          name: "bounded.txt",
          mime: "text/plain",
          text: "start fixture\n" + "x".repeat(300100),
          kind: "bounded",
        },
        {
          name: "opaque.bin",
          mime: "application/octet-stream",
          text: "opaque fixture",
          kind: "unsupported",
        },
      ];
      cases.push(
        {
          name: "over-limit.txt",
          mime: "text/plain",
          text: "x".repeat(2 * 1024 * 1024 + 1),
          kind: "unsupported",
        },
        {
          name: "bounded.csv",
          mime: "text/csv",
          text:
            "name,value\n" +
            Array.from({ length: 205 }, (_, i) => `row${i},${i}`).join("\n"),
          kind: "csv-bounded",
        },
        {
          name: "bounded.diff",
          mime: "text/x-diff",
          text: Array.from({ length: 5010 }, (_, i) => `+line ${i}`).join("\n"),
          kind: "diff-bounded",
        },
      );
      for (const item of cases) {
        await form.getByLabel("选择附件", { exact: true }).setInputFiles({
          name: item.name,
          mimeType: item.mime,
          buffer: Buffer.from(item.text),
        });
        await form.getByText("已上传", { exact: true }).waitFor();
        await form.getByRole("button", { name: "发送", exact: true }).click();
        await page
          .locator(".rah-message-files .rah-file-card")
          .filter({ hasText: item.name })
          .waitFor();
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.reload();
        for (const item of cases) {
          const card = page
            .locator(".rah-message-files .rah-file-card")
            .filter({ hasText: item.name });
          await card.locator(".rah-file-open").click();
          const dialog = page.getByRole("dialog", {
            name: "预览 " + item.name,
            exact: true,
          });
          if (item.kind === "markdown") {
            await dialog
              .getByRole("heading", { name: "Markdown fixture" })
              .waitFor();
            assert.equal(
              (await dialog.boundingBox()).width,
              width,
              "Markdown opens across the viewport",
            );
            assert.equal(
              await dialog
                .getByRole("navigation", { name: "Markdown 大纲" })
                .isVisible(),
              width >= 1280,
            );
          }
          if (item.kind === "markdown")
            await dialog
              .getByRole("heading", { name: "Markdown fixture" })
              .waitFor();
          if (item.kind === "markdown" && width >= 1280) {
            const url = page.url();
            await dialog
              .getByRole("navigation", { name: "Markdown 大纲" })
              .getByRole("link", { name: "Final section" })
              .click();
            assert.equal(
              page.url(),
              url,
              "outline scroll does not change the Room route",
            );
            assert.ok(
              await dialog
                .getByRole("heading", { name: "Final section" })
                .evaluate((e) => e.getBoundingClientRect().top < innerHeight),
              "outline reaches its rendered heading",
            );
          }
          if (item.kind === "csv")
            await dialog
              .getByRole("cell", { name: "comma,value", exact: true })
              .waitFor();
          if (item.kind === "diff")
            await dialog
              .locator(".is-addition")
              .filter({ hasText: "+new fixture" })
              .waitFor();
          if (item.kind === "html") {
            assert.equal(
              (await dialog.boundingBox()).width,
              width,
              "HTML uses the viewport viewer",
            );
            assert.equal(
              (
                (await dialog.locator("iframe").getAttribute("srcdoc")) ?? ""
              ).includes("parent.__previewExecuted"),
              false,
              "attachment script is removed; only the existing trusted bridge is allowed",
            );
            await dialog
              .frameLocator("iframe")
              .getByRole("heading", { name: "HTML fixture" })
              .waitFor();
            assert.equal(
              await page.evaluate(() => window.__previewExecuted),
              undefined,
            );
            assert.equal(
              await dialog.locator("iframe").getAttribute("sandbox"),
              "allow-scripts",
            );
          }
          if (["bounded", "csv-bounded", "diff-bounded"].includes(item.kind))
            await dialog
              .getByText("预览已截断；下载文件可查看完整内容。", {
                exact: true,
              })
              .waitFor();
          if (item.kind === "unsupported")
            await dialog
              .getByText("此文件不提供内嵌预览，请下载查看。", { exact: true })
              .waitFor();
          const downloading = page.waitForEvent("download");
          await dialog
            .getByRole("button", { name: "下载", exact: true })
            .click();
          const downloaded = await downloading;
          assert.equal(await downloaded.failure(), null);
          assert.equal(
            readFileSync(await downloaded.path(), "utf8"),
            item.text,
          );
          await page.screenshot({
            path: join(output, `${engine}-${width}-${item.name}.png`),
          });
          await page.keyboard.press("Escape");
          await dialog.waitFor({ state: "hidden" });
          assert.equal(
            await card
              .locator(".rah-file-open")
              .evaluate((el) => document.activeElement === el),
            true,
          );
          receipt.results.push({
            engine,
            width,
            kind: item.kind,
            filename: item.name,
            status: "passed",
          });
        }
      }
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.results));
  console.log(output);
}
