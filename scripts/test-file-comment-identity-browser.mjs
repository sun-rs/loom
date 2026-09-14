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
  for (const name of ["Hakase", "Hakase two"]) {
    await page.goto(
      fixture.origin + "/?surface=settings&settingsSection=account",
    );
    await page
      .getByRole("textbox", { name: "显示名称", exact: true })
      .fill(name);
    const png = Buffer.from(
      name === "Hakase"
        ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V7viPwAHwwMjerDEwwAAAABJRU5ErkJggg=="
        : "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
      "base64",
    );
    const avatar = page.locator(".rah-settings-profile-preview img");
    const previous = (await avatar.count())
      ? await avatar.getAttribute("src")
      : "";
    await page.locator('input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(avatar).not.toHaveAttribute("src", previous || "");
    const avatarSrc = await avatar.getAttribute("src");
    const saved = page.waitForResponse((r) =>
      r.url().endsWith("/principals/update"),
    );
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    assert.equal((await saved).status(), 200);
    await page.goto(fixture.origin + "/?room=" + roomId);
    await page
      .getByRole("button", { name: "预览 " + filename, exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", {
      name: "预览 " + filename,
      exact: true,
    });
    await dialog.getByRole("button", { name: "评论", exact: true }).click();
    const cards = dialog.locator(".rah-attachment-comment-card");
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      await expect(
        card.locator(".rah-attachment-comment-meta img"),
      ).toHaveAttribute("src", avatarSrc);
      await expect(
        card.locator(".rah-attachment-comment-meta strong"),
      ).toHaveText(name);
      await expect(card.locator(".rah-rich-self-reference")).toHaveText(
        "@" + name,
      );
      const mention = card.locator(".rah-rich-self-reference");
      for (const hovered of [false, true]) {
        if (hovered) await mention.hover();
        const style = await mention.evaluate((el) => {
          const s = getComputedStyle(el),
            parent = getComputedStyle(el.parentElement);
          return {
            background: s.backgroundColor,
            border: s.borderTopWidth,
            weight: s.fontWeight,
            parentWeight: parent.fontWeight,
          };
        });
        assert.equal(
          style.background,
          "rgba(0, 0, 0, 0)",
          "file comment mentions stay unhighlighted, including hover",
        );
        assert.equal(style.border, "0px");
        assert.equal(style.weight, style.parentWeight);
      }
      await page.mouse.move(0, 0);
      await expect(card.locator("code")).toHaveText("@sun");
      await expect(card).toContainText("@unknown-person");
      await expect(card.locator(".rah-attachment-anchor-badge")).toHaveCount(0);
    }
    const location = cards.first().locator(".rah-attachment-anchor-location");
    await expect(location).toHaveText("章节 · § 4. Single lane");
    assert.ok(
      (await location.locator("use").getAttribute("href")).endsWith(
        "#raft-icon-map-pin",
      ),
    );
    await expect(
      cards.last().locator(".rah-attachment-anchor-location"),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        dialog
          .locator(".rah-attachment-comments")
          .evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBe(320);
    await location.click();
    await expect(
      dialog.locator('[data-anchor-heading="attachment-section-2"]'),
    ).toHaveClass(/rah-anchor-flash/);
    await cards.first().locator(".rah-rich-self-reference").hover();
    await expect(page.locator(".rah-human-preview h2")).toHaveText(name);
    await expect(page.locator(".rah-human-preview")).toContainText("@" + name);
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: "/tmp/rah-comment-identity-" + engine.name() + ".png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(location).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    if (name === "Hakase two") {
      const composer = dialog.getByRole("textbox", {
        name: "附件评论",
        exact: true,
      });
      await composer.fill("Quiet successful comment");
      await dialog
        .getByRole("button", { name: "发送评论", exact: true })
        .click();
      await expect(composer).toHaveValue("");
      await expect(cards).toHaveCount(3);
      await expect(dialog.getByText("评论已发送", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        dialog.getByRole("link", { name: /打开讨论|打开评论/ }),
      ).toHaveCount(0);
    }
  }
  const data = await post("files/comments/list", {
    attachmentId: upload.attachmentId,
  });
  await page.goto(
    fixture.origin +
      "/?room=" +
      roomId +
      "&thread=" +
      encodeURIComponent(`${roomId}:${data.threadRootMessageId}`),
  );
  const thread = page.getByTestId("thread-side-column");
  await expect(thread.locator(".rah-message-file-reference")).toHaveCount(3);
  for (const badge of await thread.locator(".rah-message-file-reference").all())
    await expect(badge).toHaveText("评论：" + filename);
  const chatMention = thread.locator(".rah-rich-self-reference").first();
  assert.notEqual(
    await chatMention.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)",
    "ordinary chat keeps self-mention emphasis",
  );
  assert.ok(
    data.comments
      .filter((c) => c.content !== "Quiet successful comment")
      .every((c) => c.content.startsWith("@sun question")),
    "display never rewrites canonical text",
  );
  console.log(
    "Comment current names, code/unknown text, file/section distinction, mobile and repeated rename passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
