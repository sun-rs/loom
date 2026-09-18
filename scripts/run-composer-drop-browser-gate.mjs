import {
  fileTransfer,
  readyComposer,
  verifyDropEdges,
  downloadExact,
  verifyThreadDrop,
} from "./composer-drop-browser-scenarios.mjs";
import { verifyComposerPickers } from "./composer-picker-browser-scenarios.mjs";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-composer-drop-"));
const options = { extraPaths: uiContractEvidenceInputPaths() };
const receipt = {
  output,
  inputs: snapshotUiEvidenceInputs(options),
  results: [],
};
const scenario = async (id, run) => {
  receipt.scenario = id;
  await run();
};
try {
  await scenario("composer-file-drop", async () => {
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
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript(() => {
          localStorage.setItem("rah:web-push-desired:v1", "disabled");
          localStorage.setItem("rah:composer-files-mode:v1", "menu");
        });
        const post = async (path, data) => {
          const r = await page.request.post(
            fixture.origin + "/v3/client/" + path,
            { data },
          );
          assert.equal(r.status(), 200, await r.text());
          return r.json();
        };
        const workspace = (await post("workspaces/list", {})).workspaces[0];
        const seq = async (roomId) =>
          (
            await post("rooms/sync", {
              roomId,
              consumerId: "drop-gate",
              bootstrap: "latest",
              limit: 1,
            })
          ).latestRoomSeq;
        for (const width of [1440, 390]) {
          await page.setViewportSize({
            width,
            height: width === 390 ? 844 : 900,
          });
          const room = (
            await post("rooms/create", {
              workspaceId: workspace.workspaceId,
              kind: "channel",
              name: `Drop ${engine} ${width}`,
              slug: `drop-${engine}-${width}`,
              visibility: "private",
              basedOnControlRoomSeq: await seq(workspace.controlRoomId),
              idempotencyKey: crypto.randomUUID(),
            })
          ).room;
          await page.goto(fixture.origin + "/?room=" + room.roomId, {
            waitUntil: "load",
          });
          const composer = page.locator("form.composer").filter({
            has: page.getByRole("textbox", { name: "消息输入框", exact: true }),
          });
          await composer.getByRole("textbox").waitFor();
          assert.equal(
            await composer
              .getByRole("button", { name: "添加引用或附件", exact: true })
              .count(),
            1,
            "one shared add trigger replaces both picker buttons",
          );
          await page.waitForFunction(() => {
            const b = document.querySelector(
              'button[aria-label="添加引用或附件"]',
            );
            return b && !b.disabled;
          });
          const transfer = await page.evaluateHandle(() => {
            const dt = new DataTransfer();
            dt.items.add(
              new File(["drop exact content"], "dropped-note.txt", {
                type: "text/plain",
              }),
            );
            return dt;
          });
          await composer.dispatchEvent("dragenter", { dataTransfer: transfer });
          await composer
            .locator('[data-testid="composer-drop-overlay"]')
            .waitFor();
          await page.screenshot({
            path: join(output, `${engine}-overlay-${width}.png`),
          });
          await composer.dispatchEvent("drop", { dataTransfer: transfer });
          await composer.getByText("已上传", { exact: true }).waitFor();
          assert.equal(
            (await post("messages/list", { roomId: room.roomId })).messages
              .length,
            0,
            "drop is not send",
          );
          await composer
            .getByRole("button", { name: "发送", exact: true })
            .click();
          await page
            .locator(".rah-message-files")
            .getByText("dropped-note.txt", { exact: true })
            .waitFor();
          await page.reload();
          await page
            .locator(".rah-message-files")
            .getByText("dropped-note.txt", { exact: true })
            .waitFor();
          const message = (await post("messages/list", { roomId: room.roomId }))
            .messages[0];
          assert.equal(message.attachments.length, 1);
          await downloadExact(
            page,
            page.locator(".rah-message-files"),
            "dropped-note.txt",
            "drop exact content",
          );
          const form = await readyComposer(page, "消息输入框");
          const geometry = await verifyDropEdges({
            page,
            form,
            room,
            post,
            origin: fixture.origin,
            output,
            engine,
            width,
          });
          const thread = await verifyThreadDrop({
            page,
            room,
            post,
            origin: fixture.origin,
            output,
            engine,
            width,
          });
          const pickers = await verifyComposerPickers({
            page,
            room,
            post,
            origin: fixture.origin,
            output,
            engine,
            width,
            thread,
          });
          await page.goto(fixture.origin + "/?room=" + room.roomId, {
            waitUntil: "load",
          });
          await readyComposer(page, "消息输入框");
          await post("rooms/archive", {
            roomId: room.roomId,
            basedOnRoomSeq: await seq(room.roomId),
            idempotencyKey: crypto.randomUUID(),
          });
          await page.reload();
          await page.waitForFunction(() => {
            const b = document.querySelector(
              'button[aria-label="添加引用或附件"]',
            );
            return b && b.disabled;
          });
          const archivedForm = page.locator("form.composer");
          assert.equal(
            await archivedForm
              .getByRole("button", { name: "添加引用或附件", exact: true })
              .isDisabled(),
            true,
          );
          const deniedTransfer = await fileTransfer(page);
          await archivedForm.dispatchEvent("dragenter", {
            dataTransfer: deniedTransfer,
          });
          assert.equal(
            await archivedForm
              .locator('[data-testid="composer-drop-overlay"]')
              .count(),
            0,
          );
          await archivedForm.dispatchEvent("drop", {
            dataTransfer: deniedTransfer,
          });
          await deniedTransfer.dispose();
          assert.equal(
            await archivedForm.locator(".rah-file-draft").count(),
            0,
          );
          receipt.results.push({
            engine,
            width,
            roomId: room.roomId,
            status: "passed",
            geometry,
            thread,
            pickers,
          });
          await transfer.dispose();
        }
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        await fixture.close();
      }
    }
  });
  assertUiEvidenceInputSnapshot(receipt.inputs, options);
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ output, results: receipt.results }));
} catch (e) {
  console.error(output);
  throw e;
}
