import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { pdfFixture, wavFixture } from "./media-preview-fixtures.mjs";

const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE ?? "chrome";
const browser = await (engine === "firefox" ? firefox : chromium).launch({
  headless: true,
  ...(engine === "chrome"
    ? { executablePath: await findChromeExecutable() }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data) => {
    const response = await page.request.post(
      fixture.origin + "/v3/client/" + path,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const head = async (roomId) =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "preview-entry-fixture",
        bootstrap: "latest",
        limit: 1,
      })
    ).latestRoomSeq;
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "Preview entry fixture",
      slug: "preview-entry-fixture",
      visibility: "private",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  const cases = [
    {
      filename: "Entry.md",
      mimeType: "text/markdown",
      bytes: Buffer.from("# Entry fixture\n\nReadable paragraph"),
      comments: true,
    },
    {
      filename: "Entry.pdf",
      mimeType: "application/pdf",
      bytes: pdfFixture(),
      comments: false,
    },
    {
      filename: "Entry.wav",
      mimeType: "audio/wav",
      bytes: wavFixture(),
      comments: false,
    },
  ];
  for (const item of cases) {
    const upload = await post("files/prepare", {
      roomId: room.roomId,
      filename: item.filename,
      mimeType: item.mimeType,
      size: item.bytes.length,
      idempotencyKey: crypto.randomUUID(),
    });
    const response = await page.request.put(
      fixture.origin + "/v3/client/files/content/" + upload.attachmentId,
      {
        data: item.bytes,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    assert.equal(response.status(), 200, await response.text());
    await post("messages/post", {
      roomId: room.roomId,
      body: "Preview entry fixture",
      attachmentIds: [upload.attachmentId],
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: crypto.randomUUID(),
    });
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(fixture.origin + "/?room=" + room.roomId);
    for (const item of cases) {
      await page
        .locator(".rah-message-files .rah-file-card")
        .filter({ hasText: item.filename })
        .locator(".rah-file-open")
        .click();
      const dialog = page.getByRole("dialog", {
        name: "预览 " + item.filename,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "评论", exact: true }),
      ).toHaveCount(item.comments ? 1 : 0);
      if (item.comments) {
        await dialog.getByRole("button", { name: "评论", exact: true }).click();
        await expect(
          dialog.getByRole("textbox", { name: "附件评论" }),
        ).toBeEnabled();
      } else {
        await expect(
          dialog.getByRole("complementary", { name: "文件评论" }),
        ).toHaveCount(0);
      }
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    await page.getByRole("tab", { name: "文件", exact: true }).click();
    await page
      .locator(".rah-room-files .rah-file-card")
      .filter({ hasText: "Entry.md" })
      .locator(".rah-file-open")
      .click();
    const dialog = page.getByRole("dialog", {
      name: "预览 Entry.md",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "评论", exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole("heading", { name: "Entry fixture" }).click();
    await expect(
      dialog.getByRole("complementary", { name: "文件评论" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `/tmp/file-comment-entry-${engine}-${width}.png`,
    });
    await page.keyboard.press("Escape");
    console.log(
      `${engine} ${width}: chat context, PDF/audio exclusion, file-list selection passed`,
    );
  }
} finally {
  await browser.close();
  await fixture.close();
}
