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
  for (const name of ["Hakase", "Hakase two"]) {
    await page.goto(
      fixture.origin + "/?surface=settings&settingsSection=account",
    );
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill(name);
    const saved = page.waitForResponse((r) =>
      r.url().endsWith("/principals/update"),
    );
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page
      .getByRole("button", { name: "动态", exact: true })
      .first()
      .click();
    const card = page.locator(".feed-card").filter({
      has: page.locator(".fc-title", { hasText: "Activity identity" }),
    });
    await expect(card.locator(".fc-summary strong")).toHaveText(name + ":");
    await expect(card.locator(".fc-summary")).toContainText(
      "请@" + name + "看这里；`@sun`；@unknown-person",
    );
    const threadCard = page.locator(".feed-card").filter({
      has: page.locator(".fc-title", { hasText: "请@" + name + "看这里" }),
    });
    await expect(threadCard.locator(".fc-summary strong")).toHaveText(
      name + ":",
    );
    await expect(threadCard.locator(".fc-summary")).toContainText(
      "请@" + name + "看这里",
    );
    await page.reload();
    await expect(card.locator(".fc-summary strong")).toHaveText(name + ":");
    await expect(card.locator(".fc-summary")).toContainText(
      "请@" + name + "看这里",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(card).toBeVisible();
    await page.screenshot({
      path:
        "/tmp/rah-activity-names-" +
        (process.env.RAH_TEST_ENGINE ?? "chrome") +
        ".png",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const raw = await post("activity/list", {
    workspaceId: workspace.workspaceId,
  });
  assert.ok(
    raw.items
      .filter((item) => item.roomId === roomId)
      .every((item) => item.latestMessage.body === body),
  );
  console.log(
    "Activity author and mentions track repeated display-name edits, reload and mobile width",
  );
} finally {
  await browser.close();
  await fixture.close();
}
