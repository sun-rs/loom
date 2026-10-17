// Real Kernel/API/gateway with deterministic fixture messages; no paid CLI.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import { roleInstanceFixture } from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const width of [1440, 390]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  try {
    const roomId = f.home.roomId,
      peer = f.kernel.provisionPrincipal({
        handle: "fixture-peer",
        kind: "human",
      }),
      actor = f.kernel.authenticateAccessToken(peer.accessToken);
    f.kernel.addMember(f.actor, {
      roomId,
      principalId: peer.principal.principalId,
    });
    const root = f.kernel.postMessage(f.actor, {
      roomId,
      body: "FIXTURE unread thread",
      recipients: [],
      idempotencyKey: "root",
    });
    const { thread } = f.kernel.createThread(f.actor, {
      roomId,
      rootMessageId: root.event.aggregateId,
      basedOnRoomSeq: f.head(roomId),
      recipientIds: [],
      idempotencyKey: "thread",
    });
    const replies = [];
    for (let i = 0; i < 60; i++)
      replies.push(
        f.kernel.replyThread(actor, {
          roomId,
          threadId: thread.threadId,
          body: `FIXTURE reply ${i}`,
          recipientIds: [],
          basedOnRoomSeq: f.head(roomId),
          idempotencyKey: `reply-${i}`,
        }),
      );
    f.kernel.markHumanActivity(f.actor, {
      roomId,
      threadId: thread.threadId,
      throughSeq: replies[4].event.roomSeq,
      action: "read",
    });
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
    await page.goto(gateway.origin + "/?room=" + roomId);
    const badge = page.getByTestId("message-thread-replies-badge");
    await badge.getByText("55 条新回复", { exact: true }).waitFor();
    await badge.click();
    await page.waitForURL(
      (url) => url.searchParams.get("message") === replies[5].event.aggregateId,
    );
    const target = page
      .locator('[data-testid="thread-message-scroller"]')
      .locator(`[data-timeline-message-id="${replies[5].event.aggregateId}"]`);
    await target.waitFor();
    await page.waitForTimeout(500);
    const position = await target.boundingBox();
    assert.ok(
      position &&
        position.y < (width === 390 ? 844 : 1000) &&
        position.y + position.height > 0,
    );
    const after = f.kernel.listThreads(f.actor, { roomId })[0].viewerSummary;
    assert.ok(
      after.unreadCount < 55 && after.unreadCount > 0,
      "visible reading does not mark all 60 replies read",
    );
    await page.screenshot({ path: `/tmp/loom-thread-summary-${width}.png` });
    f.kernel.markHumanActivity(f.actor, {
      roomId,
      threadId: thread.threadId,
      throughSeq: replies[59].event.roomSeq,
      action: "read",
    });
    await page.goto(gateway.origin + "/?room=" + roomId);
    await badge.waitFor();
    assert.ok(!(await badge.innerText()).includes("新回复"));
    assert.deepEqual(errors, []);
    results.push({
      width,
      unreadBadge: 55,
      firstUnreadFocus: true,
      boundedViewportRead: true,
      readStatePersists: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results, null, 2));
