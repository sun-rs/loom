import assert from "node:assert/strict";
import { verifyComposerAutosize } from "./composer-autosize-browser-scenario.mjs";
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
      bytes: Buffer.from(
        "# Entry fixture\n\n" + "Readable paragraph\n\n".repeat(40),
      ),
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
  cases.push({
    filename: "Entry.html",
    mimeType: "text/html",
    bytes: Buffer.from("<h1>HTML document fixture</h1>"),
    comments: true,
  });
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
    await verifyComposerAutosize(
      page,
      page.getByRole("textbox", { name: "消息输入框", exact: true }),
      width,
    );
    if (width === 1440) {
      const roomEditor = page.getByRole("textbox", {
        name: "消息输入框",
        exact: true,
      });
      const draft = "wrapping ".repeat(24);
      await roomEditor.fill(draft);
      const wideHeight = await roomEditor.evaluate(
        (el) => el.getBoundingClientRect().height,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          roomEditor.evaluate((el) => el.getBoundingClientRect().height),
        )
        .toBeGreaterThan(wideHeight);
      await expect(roomEditor).toHaveValue(draft);
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect
        .poll(() =>
          roomEditor.evaluate((el) => el.getBoundingClientRect().height),
        )
        .toBe(wideHeight);
      const sent = page.waitForResponse(
        (r) =>
          r.url().endsWith("/messages/post") && r.request().method() === "POST",
      );
      await roomEditor.press("Enter");
      assert.equal((await sent).status(), 200);
      await expect(roomEditor).toHaveValue("");
      await expect
        .poll(() =>
          roomEditor.evaluate((el) => el.getBoundingClientRect().height),
        )
        .toBe(40);
    }
    for (const item of cases) {
      const tile = page
        .locator(".rah-message-files .rah-file-card")
        .filter({ hasText: item.filename });
      assert.equal(
        Math.round((await tile.boundingBox()).width),
        176,
        "message file card uses Raft 176px width",
      );
      assert.equal(
        Math.round((await tile.boundingBox()).height),
        80,
        "message file card uses Raft 80px height",
      );
      let releasePreview;
      const heldPreview = new Promise((resolve) => {
        releasePreview = resolve;
      });
      if (item.filename.endsWith(".html"))
        await page.route("**/files/preview/**", async (route) => {
          await heldPreview;
          await route.continue();
        });
      await page
        .locator(".rah-message-files .rah-file-card")
        .filter({ hasText: item.filename })
        .locator(".rah-file-open")
        .click();
      if (item.filename.endsWith(".html")) {
        await expect(tile.getByRole("status")).toHaveText("正在打开预览…");
        await expect(tile.locator(".rah-file-open")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await page.screenshot({
          path: `/tmp/rah-artifact-loading-${engine}-${width}.png`,
        });
        const response = page.waitForResponse((r) =>
          r.url().includes("/files/preview/"),
        );
        releasePreview();
        await response;
        await page.unroute("**/files/preview/**");
      }
      const dialog = page.getByRole("dialog", {
        name: "预览 " + item.filename,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "评论", exact: true }),
      ).toHaveCount(item.comments ? 1 : 0);
      if (item.comments) {
        await expect(
          dialog
            .getByRole("button", { name: "评论", exact: true })
            .locator("use"),
        ).toHaveAttribute("href", /#raft-icon-message-square-more$/);
        await dialog.getByRole("button", { name: "评论", exact: true }).click();
        await expect(
          dialog.getByRole("textbox", { name: "附件评论" }),
        ).toBeEnabled();
        await expect(
          dialog.locator(".rah-attachment-comments-heading"),
        ).toContainText("评论 · " + item.filename);
        await expect(
          dialog.locator(".rah-attachment-comment-empty"),
        ).toContainText(item.filename);
        assert.equal(
          await dialog
            .locator(".rah-attachment-comments")
            .evaluate(
              (e) => getComputedStyle(e).transitionDuration.split(",")[0],
            ),
          "0.3s",
        );
        await expect(
          dialog.getByRole("textbox", { name: "附件评论" }),
        ).toHaveAttribute("placeholder", "评论 " + item.filename + "…");
        await page.screenshot({
          path: `/tmp/rah-artifact-preview-${engine}-${width}.png`,
        });
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
  // Per-file count is a durable aggregate, not the current comment page length.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture.origin + "/?room=" + room.roomId);
  const markdownTile = page
    .locator(".rah-message-files .rah-file-card")
    .filter({ hasText: "Entry.md" })
    .first();
  await expect(
    markdownTile.locator(
      '[data-message-affordance="attachment-comment-count"]',
    ),
  ).toHaveCount(0);
  await markdownTile
    .getByRole("button", { name: "预览 Entry.md", exact: true })
    .click();
  const commentDialog = page.getByRole("dialog", {
    name: "预览 Entry.md",
    exact: true,
  });
  // Raft WZe/card-brutal: paper shadow and viewport (not content) breakpoint.
  const verifyMarkdownLayout = async (commentsOpen) => {
    const paper = commentDialog.locator(".rah-file-document");
    const outline = commentDialog.getByRole("navigation", {
      name: "Markdown 大纲",
    });
    await expect(paper).toHaveCSS("border-top-width", "2px");
    await expect(paper).toHaveCSS(
      "box-shadow",
      "rgb(20, 17, 17) 4px 4px 0px 0px",
    );
    for (const width of [1279, 1280, 1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width >= 1280) {
        await expect(outline).toBeVisible();
        const scroller = commentDialog.locator(".rah-file-preview-body");
        const paperTop = await paper.evaluate(
          (el) => el.getBoundingClientRect().top,
        );
        await expect
          .poll(() => outline.evaluate((el) => el.getBoundingClientRect().top))
          .toBe(paperTop);
        await scroller.evaluate((el) => {
          el.scrollTop = 150;
        });
        await expect
          .poll(() => outline.evaluate((el) => el.getBoundingClientRect().top))
          .toBe(80);
        await scroller.evaluate((el) => {
          el.scrollTop = 0;
        });
        await expect(outline).toHaveCSS("max-height", "788px");
        await expect(outline).toHaveCSS("position", "sticky");
        await expect(
          commentDialog.locator(".rah-file-document-grid"),
        ).toHaveCSS("column-gap", "24px");
      } else {
        await expect(outline).toBeHidden();
      }
      const bounds = await paper.boundingBox();
      assert.ok(
        bounds.width <= 768,
        "paper retains Raft's 48rem reading width",
      );
      assert.ok(
        bounds.x >= 0 && bounds.x + bounds.width <= width,
        "paper remains within viewport",
      );
      await page.screenshot({
        path: `/tmp/rah-markdown-paper-${engine}-${width}-${commentsOpen}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  };
  await verifyMarkdownLayout(false);
  await commentDialog
    .getByRole("button", { name: "评论", exact: true })
    .click();
  await expect
    .poll(async () =>
      commentDialog
        .locator(".rah-attachment-comments")
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBe(320);
  await verifyMarkdownLayout(true);
  const composer = commentDialog.getByRole("textbox", { name: "附件评论" });
  await expect(composer).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await verifyComposerAutosize(page, composer, width);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() =>
      commentDialog
        .locator(".rah-attachment-comments")
        .evaluate((el) => el.getBoundingClientRect().width),
    )
    .toBe(320);
  await composer.fill("File count fixture comment");
  await commentDialog
    .getByRole("button", { name: "发送评论", exact: true })
    .click();
  await expect(composer).toHaveValue("");
  await expect
    .poll(() => composer.evaluate((el) => el.getBoundingClientRect().height))
    .toBe(40);
  await expect(
    commentDialog.locator(".rah-attachment-anchor-badge"),
  ).toHaveCount(0);
  await expect(
    commentDialog.locator(".rah-attachment-comments-heading"),
  ).toContainText("Entry.md");
  await expect(
    commentDialog.locator(".rah-attachment-comment-card"),
  ).toContainText("File count fixture comment");
  await expect(
    commentDialog.getByText("评论已发送", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "/tmp/rah-file-comment-badge.png" });
  await page.keyboard.press("Escape");
  const count = markdownTile.locator(
    '[data-message-affordance="attachment-comment-count"]',
  );
  await expect(count).toHaveAttribute("aria-label", "1 条文件评论", {
    timeout: 15000,
  });
  assert.equal(
    await count.locator("svg").evaluate((e) => e.getBoundingClientRect().width),
    9,
  );
  assert.equal(
    await count
      .locator("use")
      .getAttribute("href")
      .then((x) => x.split("#")[1]),
    "raft-icon-message-square",
  );
  await expect(
    page
      .locator(".rah-message-files .rah-file-card")
      .filter({ hasText: "Entry.html" })
      .locator('[data-message-affordance="attachment-comment-count"]'),
  ).toHaveCount(0);
  await page.reload();
  await expect(count).toHaveAttribute("aria-label", "1 条文件评论");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await markdownTile.scrollIntoViewIfNeeded();
    assert.equal(Math.round((await markdownTile.boundingBox()).width), 176);
    await page.screenshot({ path: `/tmp/rah-file-comment-count-${width}.png` });
  }
} finally {
  await browser.close();
  await fixture.close();
}
