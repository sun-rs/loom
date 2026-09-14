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
      consumerId: "comment-identity",
      bootstrap: "latest",
    })
  ).latestRoomSeq;
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      visibility: "private",
      name: "Comment identity",
      slug: "comment-identity",
      basedOnControlRoomSeq: control,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  const roomId = room.roomId,
    filename = "Identity-report.md";
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "comment-identity",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const bytes = Buffer.from(
    "# Overview\n\n## 4. Single lane\n\nOnly one running lane.",
  );
  const upload = await post("files/prepare", {
    roomId,
    filename,
    mimeType: "text/markdown",
    size: bytes.length,
    idempotencyKey: crypto.randomUUID(),
  });
  const put = await page.request.put(
    fixture.origin + "/v3/client/files/content/" + upload.attachmentId,
    { data: bytes, headers: { "content-type": "application/octet-stream" } },
  );
  assert.equal(put.status(), 200);
  await post("messages/post", {
    roomId,
    body: "Comment identity fixture",
    attachmentIds: [upload.attachmentId],
    recipients: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  for (const anchor of [
    {
      type: "md-section",
      data: {
        headingId: "attachment-section-2",
        headingTitle: "4. Single lane",
      },
    },
    null,
  ]) {
    await post("files/comments/post", {
      attachmentId: upload.attachmentId,
      body: "@sun question; code: `@sun`; @unknown-person",
      anchor,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    });
  }
  const comments = await post("files/comments/list", {
    attachmentId: upload.attachmentId,
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const original =
      fixture.origin +
      "/?room=" +
      roomId +
      "&thread=" +
      encodeURIComponent(roomId + ":" + comments.threadRootMessageId);
    await page.goto(original);
    const thread = page.getByTestId("thread-side-column");
    await expect(thread).toBeVisible();
    const href = page.url();
    await page
      .getByRole("button", { name: "预览 " + filename, exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "预览 " + filename,
      exact: true,
    });
    await dialog.getByRole("button", { name: "评论", exact: true }).click();
    await expect(dialog.locator(".rah-attachment-comment-card")).toHaveCount(2);
    await expect(
      dialog.getByRole("link", { name: "打开讨论", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "发送评论", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await dialog
          .locator(".rah-attachment-comments")
          .boundingBox();
        return Math.abs(
          (width === 1440 ? bounds.width : bounds.height) -
            (width === 1440 ? 320 : 844 * 0.45),
        );
      })
      .toBeLessThan(0.1);
    await page.screenshot({
      path:
        "/tmp/rah-comment-close-" +
        (process.env.RAH_TEST_ENGINE ?? "chrome") +
        "-" +
        width +
        ".png",
    });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(page.url(), href);
    await expect(thread).toBeVisible();
    await expect(thread).toContainText("question; code:");
  }
  console.log(
    "Comment footer has no discussion link; X preserves the original discussion at desktop/mobile widths",
  );
} finally {
  await browser.close();
  await fixture.close();
}
