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
const output = mkdtempSync(join(tmpdir(), "rah-file-download-"));
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
          name: "File download fixture",
          slug: "file-download-fixture",
          visibility: "private",
          basedOnControlRoomSeq: head,
          idempotencyKey: crypto.randomUUID(),
        })
      ).room;
      await page.goto(fixture.origin + "/?room=" + room.roomId);
      const form = await readyComposer(page, "消息输入框");
      const filename = "download-fixture.txt",
        content = "Exact fixture bytes\n中文验证\n";
      await form.getByLabel("选择附件", { exact: true }).setInputFiles({
        name: filename,
        mimeType: "text/plain",
        buffer: Buffer.from(content),
      });
      await form.getByText("已上传", { exact: true }).waitFor();
      await form.getByRole("button", { name: "发送", exact: true }).click();
      const card = page
        .locator(".rah-message-files .rah-file-card")
        .filter({ hasText: filename });
      await card.waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await page.reload();
        await card.locator(".rah-file-overflow").focus();
        await page.keyboard.press("ArrowDown");
        const menu = page.getByRole("menu", {
          name: filename + " 的操作",
          exact: true,
        });
        await menu.waitFor({ timeout: 3000 });
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert.equal(
          await card
            .locator(".rah-file-overflow")
            .evaluate((el) => document.activeElement === el),
          true,
        );
        await card.locator(".rah-file-open").click();
        const dialog = page.getByRole("dialog", {
          name: "预览 " + filename,
          exact: true,
        });
        await dialog
          .getByText("Exact fixture bytes", { exact: false })
          .waitFor();
        for (const status of [503, 403]) {
          let release;
          const hold = new Promise((resolve) => {
            release = resolve;
          });
          let requests = 0,
            received;
          const requested = new Promise((resolve) => {
            received = resolve;
          });
          const routePattern = "**/v3/client/files/content/*";
          await page.route(routePattern, async (route) => {
            requests++;
            received();
            await hold;
            await route.fulfill({
              status,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: status === 403 ? "forbidden" : "unavailable",
                  message: "Fixture download rejected " + status,
                },
              }),
            });
          });
          try {
            await dialog
              .getByRole("button", { name: "下载", exact: true })
              .click();
            await requested;
            assert.equal(
              await dialog.getByRole("button", { name: /下载/ }).isDisabled(),
              true,
              "preview download must be disabled while pending",
            );
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
            assert.equal(
              await card.locator(".rah-file-overflow").isDisabled(),
              true,
            );
            await card.locator(".rah-file-open").click();
            await dialog.waitFor();
            assert.equal(
              await dialog.getByRole("button", { name: /下载/ }).isDisabled(),
              true,
            );
            assert.equal(requests, 1);
            release();
            await dialog.getByRole("alert").waitFor();
            assert.ok(
              (await dialog.getByRole("alert").textContent()).length > 0,
            );
            assert.equal(
              await dialog
                .getByRole("button", { name: "下载", exact: true })
                .isEnabled(),
              true,
            );
            await page.screenshot({
              path: join(output, `${engine}-error-${status}-${width}.png`),
            });
          } finally {
            release();
            await page.unrouteAll({ behavior: "wait" });
          }
        }
        const finished = page.waitForEvent("download");
        await dialog.getByRole("button", { name: "下载", exact: true }).click();
        const download = await finished;
        assert.equal(download.suggestedFilename(), filename);
        assert.equal(readFileSync(await download.path(), "utf8"), content);
        assert.equal(await dialog.getByRole("alert").count(), 0);
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert.equal(
          await card
            .locator(".rah-file-open")
            .evaluate((el) => document.activeElement === el),
          true,
        );
        receipt.results.push({ engine, width, status: "passed" });
      }
    } finally {
      await browser.close();
      await fixture.close();
    }
  }
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt.results));
} finally {
  console.log(output);
}
