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
    const body =
      "<!doctype html><html><body><h1>FIXTURE model document</h1><button onclick=\"this.textContent='Clicked'\">Interact</button></body></html>";
    const file = f.kernel.files.prepareWorkerMessage(run.execution, {
      filename: "model-result.html",
      mimeType: "text/html",
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
      .filter({ hasText: "model-result.html" })
      .click();
    const preview = page;
    const frame = preview.locator("iframe");
    await frame.waitFor();
    assert.equal(await frame.getAttribute("sandbox"), "allow-scripts");
    const content = frame.contentFrame();
    await content
      .getByRole("heading", { name: "FIXTURE model document" })
      .waitFor();
    await content
      .getByRole("button", { name: "Interact", exact: true })
      .click();
    await content
      .getByRole("button", { name: "Clicked", exact: true })
      .waitFor();
    const fetched = await context.request.get(await frame.getAttribute("src"));
    assert.equal(fetched.status(), 200);
    assert.match(
      fetched.headers()["content-security-policy"],
      /sandbox allow-scripts/,
    );
    assert.match(await fetched.text(), /acBridgeNonce/);
    const original = await context.request.get(
      gateway.origin + "/v3/client/files/content/" + file.attachmentId,
    );
    assert.equal(await original.text(), body);
    await preview
      .locator('[data-message-affordance="attachment-preview-mode"]')
      .click();
    if (width === 1440) {
      const overlay = page.locator(
        '[data-message-affordance="attachment-html-comment-overlay"]',
      );
      const box = await overlay.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 65);
      await page.mouse.up();
      await page
        .locator(
          '[data-message-affordance="attachment-comment-pending-anchor"]:visible',
        )
        .waitFor();
    }
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
    if (width === 1440)
      assert.equal(comments.comments[0].anchor?.type, "html-region");
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
      .filter({ hasText: "model-result.html" })
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
      path: "/tmp/loom-html-collaboration-" + width + ".png",
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
      sandboxAndNativeBridge: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
