import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const engine = process.env.RAH_BROWSER === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(12000);
  const post = async (path, data) => {
    let r = await page.request.post(f.origin + "/v3/client/" + path, { data });
    for (let i = 0; r.status() === 409 && i < 10; i++) {
      data.basedOnRoomSeq = await head();
      r = await page.request.post(f.origin + "/v3/client/" + path, { data });
    }
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId: f.roomId,
        consumerId: "shared-navigation",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const control = (
    await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "stable-search",
      bootstrap: "latest",
    })
  ).latestRoomSeq;
  f.roomId = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      visibility: "private",
      name: "Isolated search stability",
      slug: "isolated-search-stability",
      basedOnControlRoomSeq: control,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room.roomId;
  const root = (
    await post("messages/post", {
      roomId: f.roomId,
      body: "Isolated shared navigation fixture",
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).event.aggregateId;
  const t = (
    await post("threads/create", {
      roomId: f.roomId,
      rootMessageId: root,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  await post("threads/reply", {
    roomId: f.roomId,
    threadId: t.threadId,
    body: "Fixture reply",
    recipientIds: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });

  for (let i = 0; i < 65; i++)
    await post("messages/post", {
      roomId: f.roomId,
      body: `Tail fixture ${i}`,
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    });
  let reads = 0;
  page.on("response", (r) => {
    if (r.url().endsWith("/threads/list")) reads++;
  });
  await page.goto(f.origin + "/?surface=search&q=Fixture%20reply");
  await page
    .locator(".rah-search-hit")
    .filter({ hasText: "Fixture reply" })
    .first()
    .click();
  const thread = page.getByTestId("thread-side-column");
  await expect(thread).toBeVisible();
  await expect(
    thread.getByText("Fixture reply", { exact: true }),
  ).toBeVisible();
  await thread
    .getByRole("textbox", { name: "Thread 回复输入框", exact: true })
    .fill("Draft survives historical polling");
  await page.evaluate(() => {
    const node = document.querySelector('[data-testid="thread-side-column"]');
    window.threadRemovals = 0;
    new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.removedNodes)
          if (n === node || n.contains?.(node)) window.threadRemovals++;
    }).observe(document.querySelector(".rah-product-shell"), {
      childList: true,
      subtree: true,
    });
  });
  const before = reads;
  await expect
    .poll(() => reads, { timeout: 22000 })
    .toBeGreaterThanOrEqual(before + 3);
  assert.equal(
    await page.evaluate(() => window.threadRemovals),
    0,
    "polling must never remove a selected historical Thread",
  );
  for (const width of [1600, 900, 390, 1600]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(thread).toBeVisible();
    await expect(
      thread.getByRole("textbox", { name: "Thread 回复输入框", exact: true }),
    ).toHaveValue("Draft survives historical polling");
    assert.ok((await thread.boundingBox()).width >= 360);
  }
  await thread
    .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
    .first()
    .click();
  const profile = page.locator(".rah-agent-peek");
  await expect(profile).toBeVisible();
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect(thread).toBeHidden();
  await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
  await expect(thread).toBeVisible();
  await thread.locator(".rah-thread-close").click();
  await expect(thread).toHaveCount(0);
  await expect(page.locator(".rah-discovery")).toBeVisible();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(thread).toHaveCount(0);
  await page.goto(
    f.origin +
      "/?" +
      new URLSearchParams({
        surface: "search",
        room: f.roomId,
        thread: `${f.roomId}:${root}`,
        previewRoom: f.roomId,
        previewThread: t.threadId,
        previewRoot: root,
        previewMessage: root,
      }),
  );
  await expect(thread).toBeVisible();
  const rootReads = reads;
  await expect
    .poll(() => reads, { timeout: 18000 })
    .toBeGreaterThanOrEqual(rootReads + 2);
  await expect(thread).toBeVisible();
  await expect(
    thread.getByText("Isolated shared navigation fixture", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(thread).toBeVisible();
  await page.screenshot({
    path: `/tmp/search-history-${engine.name()}-mobile.png`,
  });
  await thread.locator(".rah-thread-back").click();
  await expect(thread).toHaveCount(0);
  await expect(page.locator(".rah-discovery")).toBeVisible();
  console.log(
    "PASS historical search thread stays mounted across polling, profile, width changes and close",
  );
} finally {
  await browser.close();
  await f.close();
}
