import assert from "node:assert/strict";
import { expect } from "playwright/test";
import { join } from "node:path";

export async function verifyCommentPagination({
  page,
  post,
  head,
  attachmentId,
  roomId,
  origin,
  filename,
  output,
  engine,
}) {
  for (let index = 0; index < 112; index++) {
    await post("/v3/client/files/comments/post", {
      attachmentId,
      body: `Pagination record ${index}`,
      anchor: { type: "lines", data: { start: (index % 120) + 1 } },
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: `pagination-${index}`,
    });
  }
  const source = await post("/v3/client/files/comments/list", {
    attachmentId,
    limit: 1,
  });
  assert.ok(source.threadRootMessageId);
  // The original message is outside the latest Room window after seeding replies.
  // Open its canonical Thread rather than enabling comments from the file list.
  await page.goto(
    origin +
      "/?target=message&message=" +
      source.messageId +
      "&threadId=" +
      source.threadId +
      "&room=" +
      roomId +
      "&thread=" +
      encodeURIComponent(roomId + ":" + source.threadRootMessageId),
  );
  await page
    .locator(".rah-message-files .rah-file-open")
    .filter({ hasText: filename })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: "预览 " + filename });
  await modal.getByRole("button", { name: "评论", exact: true }).click();
  const read = (beforeRoomSeq) =>
    post("/v3/client/files/comments/list", {
      attachmentId,
      limit: 50,
      ...(beforeRoomSeq === undefined ? {} : { beforeRoomSeq }),
    });
  const rendered = () =>
    modal.locator(".rah-attachment-comment-body").allTextContents();
  const matches = async (data) => {
    await expect
      .poll(async () => (await rendered()).map((s) => s.trim()))
      .toEqual(data.comments.map((c) => c.content));
    assert.ok(data.comments.length <= 50);
  };
  const latest = await read();
  await matches(latest);
  const seen = new Set(latest.comments.map((c) => c.id));
  let cursor = latest.nextBeforeRoomSeq,
    pages = 1,
    first = true;
  while (cursor !== undefined && cursor !== null) {
    const before = cursor;
    await modal.getByRole("button", { name: "更早评论", exact: true }).click();
    const older = await read(before);
    await matches(older);
    for (const comment of older.comments) {
      assert.equal(
        seen.has(comment.id),
        false,
        "pagination repeats a durable comment",
      );
      seen.add(comment.id);
    }
    if (first) {
      first = false;
      await post("/v3/client/files/comments/post", {
        attachmentId,
        body: "New comment during older page",
        recipientIds: [],
        basedOnRoomSeq: await head(),
        idempotencyKey: "pagination-during-read",
      });
      const polled = page.waitForResponse(
        (response) =>
          response.url().endsWith("/files/comments/list") &&
          response.request().postDataJSON()?.beforeRoomSeq === before,
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await polled;
      await matches(older);
    }
    cursor = older.nextBeforeRoomSeq;
    pages++;
  }
  assert.equal(pages, 3);
  // Three pre-existing comments, 112 seeded comments. The later insertion must
  // appear only on return to latest, never move the frozen older page.
  assert.equal(seen.size, 115);
  await expect(
    modal.getByRole("button", { name: "更早评论", exact: true }),
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "最新评论", exact: true }).click();
  await matches(await read());
  await expect(
    modal.getByText("New comment during older page", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, `${engine}-pagination-latest.png`),
  });
  await page.reload();
  await page
    .locator(".rah-message-files .rah-file-open")
    .filter({ hasText: filename })
    .first()
    .click();
  await expect(modal)
    .toBeVisible({ timeout: 5000 })
    .catch(async (error) => {
      await page.screenshot({
        path: join(output, `${engine}-reload-failure.png`),
      });
      console.log(await page.locator("[role=alert]").allTextContents());
      throw error;
    });
  await modal.getByRole("button", { name: "评论", exact: true }).click();
  await matches(await read());
  await modal.getByRole("button", { name: "关闭", exact: true }).click();
  return {
    pages,
    uniqueFrozenComments: seen.size,
    maxPageSize: 50,
    concurrentInsertion: true,
    reload: true,
  };
}
