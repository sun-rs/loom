import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = process.env.RAH_BACKEND_GAP_EVIDENCE;
if (!output) throw new Error("RAH_BACKEND_GAP_EVIDENCE is required");
mkdirSync(output, { recursive: true });
const results = [];
// API actions use an isolated real daemon and temporary data. No formal-state
// mutations or invented UI buttons: verify existing Task/Thread projections.
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const post = async (path, data) => {
      const response = await page.request.post(fixture.origin + path, { data });
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const head = async (roomId = taskRoomId) =>
      (
        await post("/v3/client/rooms/sync", {
          roomId,
          consumerId: "gap-browser",
          bootstrap: "latest",
        })
      ).latestRoomSeq;
    await page.goto(fixture.origin + "/?surface=tasks");
    // Task Matrix has no Agent members: verify idle deletion without racing the
    // unrelated chat fixture's Fake CLI auto-claim/cancellation lifecycle.
    const matrixCard = page.locator(".rah-global-card-open").filter({
      hasText: "Keep the Room-first delivery contract stable",
    });
    await expect(matrixCard).toBeVisible();
    const taskRoomId = await matrixCard.evaluate(
      (element) => element.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    const title = `Isolated deletion acceptance ${engine}`;
    const created = await post("/v3/client/tasks/create", {
      roomId: taskRoomId,
      title,
      dependencyTaskIds: [],
      collaboratorIds: [],
      reviewerIds: [],
      basedOnRoomSeq: await head(taskRoomId),
      idempotencyKey: "browser-delete-create",
    });
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: title });
    await expect(card).toBeVisible({ timeout: 15000 });
    const deleted = await post("/v3/client/tasks/delete", {
      roomId: taskRoomId,
      taskId: created.task.taskId,
      basedOnRoomSeq: await head(taskRoomId),
      idempotencyKey: "browser-delete",
    });
    assert.equal(deleted.deleted, true);
    await expect(card).toHaveCount(0, { timeout: 15000 });
    await page.reload();
    await expect(matrixCard).toBeVisible({ timeout: 15000 });
    await expect(card).toHaveCount(0, { timeout: 15000 });
    await page.screenshot({ path: join(output, `${engine}-task-deleted.png`) });
    const bytes = Buffer.from("one\ntwo\nthree");
    const upload = await post("/v3/client/files/prepare", {
      roomId: taskRoomId,
      filename: "acceptance-lines.txt",
      mimeType: "text/plain",
      size: bytes.length,
      idempotencyKey: "browser-file",
    });
    const put = await page.request.put(
      fixture.origin + "/v3/client/files/content/" + upload.attachmentId,
      { data: bytes, headers: { "content-type": "application/octet-stream" } },
    );
    assert.equal(put.status(), 200, await put.text());
    const parent = await post("/v3/client/messages/post", {
      roomId: taskRoomId,
      body: "Isolated attachment acceptance",
      attachmentIds: [upload.attachmentId],
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "browser-file-post",
    });
    const body = `Verified anchored comment ${engine}`;
    const anchor = { type: "lines", data: { start: 2, end: 2, quote: "two" } };
    await post("/v3/client/files/comments/post", {
      attachmentId: upload.attachmentId,
      body,
      anchor,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "browser-comment",
    });
    const comments = await post("/v3/client/files/comments/list", {
      attachmentId: upload.attachmentId,
    });
    assert.deepEqual(comments.comments[0].anchor, anchor);
    await page.goto(
      fixture.origin +
        `/?room=${taskRoomId}&threadId=${comments.threadId}&thread=${taskRoomId}:${parent.event.aggregateId}`,
    );
    await expect(
      page.getByTestId("thread-side-column").getByText(body, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByTestId("thread-side-column").getByText(body, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(output, `${engine}-comment-thread-reloaded.png`),
    });
    assert.deepEqual(errors, []);
    results.push({
      engine,
      taskId: created.task.taskId,
      deleted: true,
      threadId: comments.threadId,
      anchor,
      reloaded: true,
      errors,
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
