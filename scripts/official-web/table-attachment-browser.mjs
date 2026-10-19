import * as XLSX from "xlsx";
// Real Kernel/Worker API semantics, fake execution; no provider or paid model.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const format of ["csv", "xlsx"])
  for (const width of [1440, 390]) {
    const f = roleInstanceFixture();
    let service, gateway, browser;
    try {
      const run = startInstanceRun(f);
      f.kernel.syncWorker(run.execution, {});
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["Name", "Value"],
          ["FIXTURE table", 12],
        ]),
        "First",
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([["Other"], ["Second sheet"]]),
        "Second",
      );
      const body =
        format === "csv"
          ? Buffer.from("Name,Value\nFIXTURE table,12\n")
          : XLSX.write(book, {
              type: "buffer",
              bookType: "xlsx",
              compression: true,
            });
      const file = f.kernel.files.prepareWorkerMessage(run.execution, {
        filename: "model-result." + format,
        mimeType:
          format === "csv"
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: Buffer.byteLength(body),
        idempotencyKey: "publish-file",
      });
      await f.kernel.files.uploadWorkerMessage(
        run.execution,
        file.attachmentId,
        (async function* () {
          yield Buffer.from(body);
        })(),
      );
      const diffBody =
        "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n";
      const diff = f.kernel.files.prepareWorkerMessage(run.execution, {
        filename: "changes.diff",
        mimeType: "text/x-diff",
        size: Buffer.byteLength(diffBody),
        idempotencyKey: "diff-file",
      });
      await f.kernel.files.uploadWorkerMessage(
        run.execution,
        diff.attachmentId,
        (async function* () {
          yield Buffer.from(diffBody);
        })(),
      );
      const sent = f.kernel.postWorkerMessage(run.execution, {
        body: "FIXTURE model output",
        attachmentIds: [file.attachmentId, diff.attachmentId],
        threadId: null,
        basedOnRoomSeq: run.activation.toSeq,
        idempotencyKey: "publish-message",
      });
      assert.ok("event" in sent);
      run.finish(0);
      service = new ClientApplicationService({
        human: createHumanApplicationPort(f.kernel),
        health: () => {
          throw Error("unused");
        },
      });
      await service.start();
      gateway = new LocalWorkbenchGateway({
        accessToken: f.owner.accessToken,
        daemonOrigin: service.origin,
        port: 0,
        sessionToken: "x".repeat(43),
        staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
      });
      await gateway.start();
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        deviceScaleFactor: 1,
        locale: "zh-CN",
        isMobile: width === 390,
        hasTouch: width === 390,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(gateway.origin + "/?room=" + f.home.roomId);
      const diffCard = page
        .getByTestId("loom-message-attachments")
        .getByRole("button")
        .filter({ hasText: "changes.diff" });
      await diffCard.getByText("+1", { exact: true }).waitFor();
      await diffCard.getByText("-1", { exact: true }).waitFor();
      const downloadEvent = page.waitForEvent("download");
      await diffCard.click();
      assert.equal((await downloadEvent).suggestedFilename(), "changes.diff");
      await page
        .getByTestId("loom-message-attachments")
        .getByRole("button")
        .filter({ hasText: "model-result." + format })
        .click();
      const preview = page.getByTestId(
        "attachment-preview-browser-find-scroll",
      );
      await preview
        .getByRole("cell", { name: "FIXTURE table", exact: true })
        .waitFor();

      assert.equal(
        await preview
          .locator("table")
          .evaluate((el) => el.parentElement?.getAttribute("data-slot")),
        "card",
      );
      assert.equal(
        await preview
          .locator("table")
          .evaluate((el) => getComputedStyle(el).fontFamily.includes("mono")),
        true,
      );
      await page.screenshot({ path: `/tmp/loom-table-${format}-${width}.png` });

      if (format === "xlsx") {
        await preview.getByRole("tab", { name: "Second", exact: true }).click();
        await preview
          .getByRole("cell", { name: "Second sheet", exact: true })
          .waitFor();
        await preview.getByRole("tab", { name: "First", exact: true }).click();
      }
      await preview
        .locator('[data-message-affordance="attachment-preview-mode"]')
        .click();
      const input = preview
        .locator(
          '[data-message-affordance="attachment-comment-composer"]:visible',
        )
        .getByTestId("composer-textarea");
      await input.fill("FIXTURE please clarify this design");
      await input.press("Enter");
      await preview
        .locator("p:visible")
        .filter({ hasText: /^FIXTURE please clarify this design$/ })
        .waitFor();
      const comments = f.kernel.attachmentComments.list(f.actor, {
        attachmentId: file.attachmentId,
      });
      assert.ok(comments.threadId);
      const reply = startInstanceRunFromQueue(f);
      f.kernel.syncWorker(reply.execution, {});
      const result = f.kernel.postWorkerMessage(reply.execution, {
        body: "FIXTURE model explains the design",
        commentAttachmentId: file.attachmentId,
        threadId: comments.threadId,
        basedOnRoomSeq: reply.activation.toSeq,
        idempotencyKey: "model-comment",
      });
      assert.ok("event" in result, JSON.stringify(result));
      reply.finish(0);
      await preview
        .locator("p:visible")
        .filter({ hasText: /^FIXTURE model explains the design$/ })
        .waitFor();
      f.kernel.replyThread(f.actor, {
        roomId: f.home.roomId,
        threadId: comments.threadId,
        body: "FIXTURE ordinary thread reply",
        recipientIds: [],
        basedOnRoomSeq: f.head(f.home.roomId),
        idempotencyKey: "ordinary",
      });
      const final = f.kernel.attachmentComments.list(f.actor, {
        attachmentId: file.attachmentId,
      });
      assert.equal(final.comments.length, 2);
      assert.equal(final.comments[1].senderType, "agent");
      await page.reload();
      await page
        .getByTestId("loom-message-attachments")
        .getByRole("button")
        .filter({ hasText: "model-result." + format })
        .click();
      await preview
        .locator('[data-message-affordance="attachment-preview-mode"]')
        .click();
      await preview
        .locator("p:visible")
        .filter({ hasText: /^FIXTURE model explains the design$/ })
        .waitFor();
      assert.equal(
        await preview
          .getByText("FIXTURE ordinary thread reply", { exact: true })
          .count(),
        0,
      );
      await page.waitForTimeout(350); // Native mobile sheet height transition.
      await page.screenshot({
        path: "/tmp/loom-table-" + format + "-" + width + ".png",
      });
      await preview.getByRole("button", { name: "关闭", exact: true }).click();
      assert.deepEqual(errors, []);
      results.push({
        width,
        workerPublished: true,
        humanCommentWakesAuthor: true,
        explicitWorkerReply: true,
        ordinaryReplyExcluded: true,
        reload: true,
        format,
        nativeTableAndSheets: true,
      });
    } finally {
      await browser?.close();
      await gateway?.stop();
      await service?.close();
      f.close();
    }
  }
console.log(JSON.stringify(results, null, 2));
