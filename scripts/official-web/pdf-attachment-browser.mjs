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
} from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const width of [1440, 390]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  try {
    const run = startInstanceRun(f);
    f.kernel.syncWorker(run.execution, {});
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    const content = "BT /F1 24 Tf 72 700 Td (FIXTURE PDF preview) Tj ET";
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
    let body = "%PDF-1.4\n",
      offsets = [0];
    objects.forEach((object, i) => {
      offsets.push(Buffer.byteLength(body));
      body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(body);
    body += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join(
        "",
      )}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = f.kernel.files.prepareWorkerMessage(run.execution, {
      filename: "model-result.pdf",
      mimeType: "application/pdf",
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
    browser = await chromium.launch({ headless: true, channel: "chromium" });
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
      .filter({ hasText: "model-result.pdf" })
      .click();
    const frame = page.locator("iframe");
    await frame.waitFor();
    const url = await frame.getAttribute("src");
    assert.ok(url);
    assert.notEqual(new URL(url).origin, gateway.origin);
    assert.equal(await frame.getAttribute("sandbox"), null);
    assert.equal(
      await page
        .locator('[data-message-affordance="attachment-preview-mode"]')
        .count(),
      0,
    );
    const response = await context.request.get(url, {
      headers: { range: "bytes=0-4" },
    });
    assert.equal(response.status(), 206);
    assert.equal(response.headers()["content-type"], "application/pdf");
    assert.equal(await response.text(), "%PDF-");
    assert.match(
      response.headers()["content-security-policy"],
      /frame-ancestors/,
    );
    await page.waitForTimeout(2200); // Browser's native PDF plugin loads outside React.
    await page.screenshot({ path: "/tmp/loom-pdf-" + width + ".png" });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载", exact: true }).click();
    assert.equal((await downloading).suggestedFilename(), "model-result.pdf");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await frame.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    results.push({
      width,
      isolatedOrigin: true,
      nativePdfFrame: true,
      range: true,
      commentsDisabled: true,
      download: true,
      close: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
