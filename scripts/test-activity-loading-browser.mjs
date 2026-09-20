import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(6000);
  const post = async (path, data) => {
    const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const control = (
    await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "activity-identity",
      bootstrap: "latest",
    })
  ).latestRoomSeq;
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      visibility: "private",
      name: "Activity identity",
      slug: "activity-identity",
      basedOnControlRoomSeq: control,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  const roomId = room.roomId;
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "activity-identity",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const body = "请@sun看这里；`@sun`；@unknown-person";
  const root = await post("messages/post", {
    roomId,
    body,
    recipients: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const thread = (
    await post("threads/create", {
      roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  await post("threads/reply", {
    roomId,
    threadId: thread.threadId,
    body,
    recipientIds: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });

  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let captured = false;
  let contexts = 0;
  const independentReads = new Set();
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      [
        "messages/list",
        "tasks/list",
        "threads/list",
        "rooms/members/list",
        "rooms/agents/activity/list",
      ].some((suffix) => path.endsWith("/" + suffix)) &&
      request.postDataJSON()?.roomId === roomId
    )
      independentReads.add(path);
  });
  page.on("response", (r) => {
    if (r.url().endsWith("/messages/context") && r.status() === 200) contexts++;
  });
  await page.route("**/v3/client/rooms/sync", async (route) => {
    if (route.request().postDataJSON().roomId === roomId) {
      captured = true;
      await held;
    }
    await route.continue();
  });
  await page.goto(fixture.origin + "/?surface=activity");
  await page
    .locator(".feed-card")
    .filter({
      has: page.locator(".fc-title", { hasText: "Activity identity" }),
    })
    .locator(".rah-activity-open")
    .click();
  await expect(async () => {
    assert.ok(captured);
    assert.equal(
      contexts,
      1,
      "only the conversation reads message context; navigation uses its canonical resolver",
    );
  }).toPass({ timeout: 5000 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  try {
    await expect(page.locator(".channel .msg")).toHaveCount(0);
    await expect(async () => {
      assert.equal(
        independentReads.size,
        5,
        "independent conversation reads must start while Room sync is still pending",
      );
    }).toPass({ timeout: 1500 });
  } finally {
    release();
  }
  await expect(
    page.locator(`.channel [data-message-id="${root.event.aggregateId}"]`),
  ).toBeVisible();
  await expect(page.locator(".channel .msg-head").first()).toContainText("sun");
  assert.doesNotMatch(await page.locator(".channel").innerText(), /principal_/);
  await page.getByRole("button", { name: "关闭动态预览", exact: true }).click();
  let releaseRefresh;
  const refreshHeld = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/v3/client/rooms/sync", async (route) => {
    if (route.request().postDataJSON().roomId === roomId) await refreshHeld;
    await route.continue();
  });
  try {
    await page
      .locator(".feed-card")
      .filter({
        has: page.locator(".fc-title", { hasText: "Activity identity" }),
      })
      .locator(".rah-activity-open")
      .click();
    await expect(
      page.locator(`.channel [data-message-id="${root.event.aggregateId}"]`),
    ).toBeVisible({ timeout: 1500 });
    await expect(page.locator(".channel .msg-head").first()).toContainText(
      "sun",
    );
  } finally {
    releaseRefresh();
  }
  console.log(
    "PASS parallel coherent loading and same-Room reopening without polling",
  );
} finally {
  await browser.close();
  await fixture.close();
}
