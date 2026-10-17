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
for (const width of [1440, 390]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  try {
    const run = startInstanceRun(f);
    f.kernel.syncWorker(run.execution, {});
    const body = "# FIXTURE model document\n\nThe proposed design.\n";
    const file = f.kernel.files.prepareWorkerMessage(run.execution, {
      filename: "model-result.md",
      mimeType: "text/markdown",
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
    const sent = f.kernel.postWorkerMessage(run.execution, {
      body: "FIXTURE model output",
      attachmentIds: [file.attachmentId],
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
    await page
      .getByTestId("loom-message-attachments")
      .getByRole("button")
      .filter({ hasText: "model-result.md" })
      .click();
    const preview = page.getByTestId("attachment-preview-browser-find-scroll");
    await preview
      .getByRole("heading", { name: "FIXTURE model document", exact: true })
      .waitFor();
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
      .filter({ hasText: "model-result.md" })
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
      path: "/tmp/loom-attachment-collaboration-" + width + ".png",
    });
    await preview.getByRole("button", { name: "关闭", exact: true }).click();
    const secondBody = "# FIXTURE second document\n\nLatest selected document.";
    const second = f.kernel.files.prepare(f.actor, {
      roomId: f.home.roomId,
      filename: "second.md",
      mimeType: "text/markdown",
      size: Buffer.byteLength(secondBody),
      idempotencyKey: "second-file",
    });
    await f.kernel.files.upload(
      f.actor,
      second.attachmentId,
      (async function* () {
        yield Buffer.from(secondBody);
      })(),
    );
    f.kernel.postRoomMessage(f.actor, {
      roomId: f.home.roomId,
      body: "FIXTURE second message",
      attachmentIds: [second.attachmentId],
      recipients: [],
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second-message",
    });
    await page.reload();
    let release, started;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const intercepted = new Promise((resolve) => {
      started = resolve;
    });
    const firstPath = "**/v3/client/files/preview/" + file.attachmentId;
    await page.route(firstPath, async (route) => {
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await page
      .getByTestId("loom-message-attachments")
      .getByRole("button")
      .filter({ hasText: "model-result.md" })
      .click();
    await intercepted;
    await page
      .getByTestId("loom-message-attachments")
      .getByRole("button")
      .filter({ hasText: "second.md" })
      .click();
    await preview
      .getByRole("heading", { name: "FIXTURE second document", exact: true })
      .waitFor();
    release();
    await page.unroute(firstPath);
    await page.waitForTimeout(250);
    assert.equal(
      await preview
        .getByRole("heading", { name: "FIXTURE second document", exact: true })
        .isVisible(),
      true,
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      workerPublished: true,
      humanCommentWakesAuthor: true,
      explicitWorkerReply: true,
      ordinaryReplyExcluded: true,
      reload: true,
      latestPreviewWins: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
