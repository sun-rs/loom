import assert from "node:assert/strict";
import { LocalWorkbenchGateway } from "../packages/daemon/src/local-workbench-gateway.ts";
import { verifyCommentPagination } from "./attachment-comment-pagination-scenario.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import {
  videoFixture,
  pdfFixture,
  wavFixture,
} from "./media-preview-fixtures.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = process.env.RAH_ATTACHMENT_COMMENTS_EVIDENCE;
if (!output) throw new Error("RAH_ATTACHMENT_COMMENTS_EVIDENCE is required");
mkdirSync(output, { recursive: true });
const results = [];
const producer = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
const producerPage = await producer.newPage();
const videoBytes = await videoFixture(producerPage);
const png = Buffer.from(
  await producerPage.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 80;
    c.height = 40;
    return Array.from(
      Uint8Array.from(atob(c.toDataURL("image/png").split(",")[1]), (n) =>
        n.charCodeAt(0),
      ),
    );
  }),
);
await producer.close();
for (const engine of (
  process.env.RAH_COMMENT_ENGINES ?? "chrome,firefox"
).split(",")) {
  const backend = await startShellFixture();
  const gateway =
    process.env.RAH_COMMENT_PRODUCTION === "1"
      ? new LocalWorkbenchGateway({
          accessToken: "isolated-comment-fixture",
          sessionToken: "fixture-comment-session-".padEnd(43, "x"),
          daemonOrigin: backend.origin,
          port: 0,
          staticDirectory: join(process.cwd(), "apps/web/dist-workbench"),
        })
      : undefined;
  try {
    await gateway?.start();
  } catch (error) {
    await backend.close();
    throw error;
  }
  const fixture = {
    origin: gateway?.origin ?? backend.origin,
    close: async () => {
      await gateway?.stop();
      await backend.close();
    },
  };
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.untrustedScriptRan = false;
      window.addEventListener("message", (event) => {
        if (event.data === "UNTRUSTED_SCRIPT_RAN")
          window.untrustedScriptRan = true;
      });
    });
    const post = async (path, data) => {
      const r = await page.request.post(fixture.origin + path, {
        data,
        headers: { origin: fixture.origin },
      });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: "Keep the Room-first delivery contract stable" });
    await expect(card).toBeVisible();
    const roomId = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    const head = async () =>
      (
        await post("/v3/client/rooms/sync", {
          roomId,
          consumerId: "attachment-ui-gate",
          bootstrap: "latest",
        })
      ).latestRoomSeq;
    const filename = "Commented lines.txt",
      bytes = Buffer.from(
        Array.from(
          { length: 120 },
          (_, i) => `Line ${i + 1}: stable source content`,
        ).join("\n"),
      );
    const upload = await post("/v3/client/files/prepare", {
      roomId,
      filename,
      mimeType: "text/plain",
      size: bytes.length,
      idempotencyKey: "ui-file",
    });
    const put = await page.request.put(
      fixture.origin + "/v3/client/files/content/" + upload.attachmentId,
      {
        data: bytes,
        headers: {
          "content-type": "application/octet-stream",
          origin: fixture.origin,
        },
      },
    );
    assert.equal(put.status(), 200);
    await post("/v3/client/messages/post", {
      roomId,
      body: "File comment UI acceptance",
      attachmentIds: [upload.attachmentId],
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "ui-publish",
    });
    await page.goto(fixture.origin + "/?room=" + roomId);
    await page
      .getByRole("button", { name: new RegExp(filename) })
      .filter({ has: page.locator("strong") })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "预览 " + filename });
    await expect(
      dialog.getByRole("button", { name: "评论", exact: true }),
    ).toBeVisible({ timeout: 3000 });
    await dialog.locator('[data-anchor-line="2"]').click();
    await expect(dialog.getByText("第 2 行", { exact: true })).toBeVisible();
    const composer = dialog.getByRole("textbox", { name: "附件评论" });
    await composer.fill("Pointer selected canonical comment");
    await composer.press("Enter");
    const comment = dialog.getByRole("button", {
      name: /定位第 2 行：Pointer selected canonical comment/,
    });
    await expect(comment).toBeVisible();
    const saved = await post("/v3/client/files/comments/list", {
      attachmentId: upload.attachmentId,
    });
    assert.equal(saved.comments.length, 1);
    assert.equal(saved.comments[0].anchor.data.start, 2);
    assert.equal(saved.roomId, roomId);
    await dialog
      .locator(".rah-file-preview-body")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await comment.click();
    const target = dialog.locator('[data-anchor-line="2"]');
    await expect(target).toHaveClass(/rah-anchor-flash/);
    await expect
      .poll(async () =>
        target.evaluate((e) => {
          const a = e.getBoundingClientRect(),
            b = e.closest(".rah-file-preview-body").getBoundingClientRect();
          return a.top >= b.top && a.bottom <= b.bottom;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: join(output, engine + "-line-anchor.png") });
    await page.reload();
    await page
      .getByRole("button", { name: new RegExp(filename) })
      .filter({ has: page.locator("strong") })
      .first()
      .click();
    await dialog.getByRole("button", { name: "评论", exact: true }).click();
    await expect(comment).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(composer).toBeVisible();
    await page.screenshot({
      path: join(output, engine + "-mobile-comments.png"),
    });

    await composer.fill("Draft survives mobile collapse");
    const collapse = dialog.getByRole("button", {
      name: "收起评论",
      exact: true,
    });
    await collapse.click();
    await expect(composer).toBeHidden();
    const expand = dialog.getByRole("button", {
      name: "展开评论",
      exact: true,
    });
    await expect(expand).toBeVisible();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect
      .poll(() =>
        dialog
          .locator(".rah-attachment-comments")
          .evaluate((element) =>
            Math.round(element.getBoundingClientRect().height),
          ),
      )
      .toBe(40);
    await page.screenshot({
      path: join(output, engine + "-mobile-collapsed.png"),
    });
    await expand.click();
    await expect(composer).toHaveValue("Draft survives mobile collapse");
    await comment.click();
    await expect(expand).toBeVisible();
    await expect(composer).toBeHidden();
    await expand.click();
    await composer.fill("");
    await page.setViewportSize({ width: 1440, height: 900 });
    // A lost response must retry the durable command, keeping the exact draft/key.
    let loseResponse = true;
    await page.route("**/v3/client/files/comments/post", async (route) => {
      if (loseResponse) {
        loseResponse = false;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await composer.fill("Retry after actual canonical commit");
    await composer.press("Enter");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(composer).toHaveValue("Retry after actual canonical commit");
    await dialog.getByRole("button", { name: "发送评论", exact: true }).click();
    await expect(composer).toHaveValue("");
    const retried = await post("/v3/client/files/comments/list", {
      attachmentId: upload.attachmentId,
    });
    assert.equal(
      retried.comments.filter(
        (c) => c.content === "Retry after actual canonical commit",
      ).length,
      1,
    );
    await page.unroute("**/v3/client/files/comments/post");
    await composer.fill("Draft survives polling failure");
    await page.route("**/v3/client/files/comments/list", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "unavailable",
            message: "Isolated comment read failure",
          },
        }),
      }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 8000 });
    await expect(composer).toHaveValue("Draft survives polling failure");
    await page.unroute("**/v3/client/files/comments/list");
    await dialog.getByRole("button", { name: "重试", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(composer).toHaveValue("Draft survives polling failure");
    await composer.fill("");
    // Unrecognized metadata remains visible without an invented jump control.
    await post("/v3/client/files/comments/post", {
      attachmentId: upload.attachmentId,
      body: "Unknown anchor retained",
      anchor: { type: "future-anchor", data: { selector: "body" } },
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "unknown-anchor",
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(dialog.getByText("当前预览不支持此位置")).toBeVisible({
      timeout: 8000,
    });
    await expect(dialog.getByRole("link", { name: "打开讨论" })).toHaveCount(0);
    const originUrl = page.url();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(page.url(), originUrl);
    // Independently verify canonical comment references through the existing Thread route.
    await page.goto(
      fixture.origin +
        "/?room=" +
        roomId +
        "&thread=" +
        encodeURIComponent(`${roomId}:${saved.threadRootMessageId}`),
    );
    await expect(
      page
        .getByTestId("thread-side-column")
        .getByText("Pointer selected canonical comment", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("thread-side-column")
        .locator(".rah-message-file-reference")
        .first(),
    ).toHaveText("评论：" + filename);
    const cases = [
      {
        filename: "Rows.csv",
        mime: "text/csv",
        bytes: Buffer.from("name,value\none,1\ntwo,2"),
        selector: '[data-anchor-row="2"]',
        anchorType: "csv-rows",
      },
      {
        filename: "Plan.md",
        mime: "text/markdown",
        bytes: Buffer.from(
          "# Plan\n\nIntro\n\n## Decision\n\nStable heading body",
        ),
        selector: '[data-anchor-heading="attachment-section-2"]',
        anchorType: "md-section",
      },
      {
        filename: "Patch.diff",
        mime: "text/plain",
        bytes: Buffer.from("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new"),
        selector: '[data-anchor-line="5"]',
        anchorType: "lines",
      },
      {
        filename: "Clip.webm",
        mime: "video/webm",
        bytes: videoBytes,
        anchorType: "video-timestamp",
      },
      { filename: "Image.png", mime: "image/png", bytes: png },
      { filename: "Paper.pdf", mime: "application/pdf", bytes: pdfFixture() },
      { filename: "Sound.wav", mime: "audio/wav", bytes: wavFixture() },
      {
        filename: "Sandbox.html",
        mime: "text/html",
        bytes: Buffer.from(
          '<h1>Sandbox content</h1><p>Second <b>inline</b> paragraph</p><script>parent.postMessage("UNTRUSTED_SCRIPT_RAN", "*")</script><div style="height:1600px"></div><p>Deep HTML destination</p>',
        ),
        anchorType: "html-region",
      },
    ];
    const verified = [];
    for (let i = 0; i < cases.length; i++) {
      const item = cases[i],
        up = await post("/v3/client/files/prepare", {
          roomId,
          filename: item.filename,
          mimeType: item.mime,
          size: item.bytes.length,
          idempotencyKey: "case-" + i,
        });
      const put = await page.request.put(
        fixture.origin + "/v3/client/files/content/" + up.attachmentId,
        {
          data: item.bytes,
          headers: {
            "content-type": "application/octet-stream",
            origin: fixture.origin,
          },
        },
      );
      assert.equal(put.status(), 200);
      await post("/v3/client/messages/post", {
        roomId,
        body: "Case " + item.filename,
        attachmentIds: [up.attachmentId],
        recipients: [],
        basedOnRoomSeq: await head(),
        idempotencyKey: "case-publish-" + i,
      });
      await page.goto(fixture.origin + "/?room=" + roomId);
      const opener = page.getByRole("button", {
        name: "预览 " + item.filename,
        exact: true,
      });
      await opener.click();
      const modal = page.getByRole("dialog", { name: "预览 " + item.filename });
      if (item.mime === "application/pdf" || item.mime === "audio/wav") {
        await expect(modal).toBeVisible();
        await expect(
          modal.getByRole("button", { name: "评论", exact: true }),
        ).toHaveCount(0);
        await expect(modal.locator(".rah-attachment-comments")).toHaveCount(0);
        const list = await post("/v3/client/files/comments/list", {
          attachmentId: up.attachmentId,
        });
        assert.equal(list.comments.length, 0);
        await modal.getByRole("button", { name: "关闭", exact: true }).click();
        await expect(opener).toBeFocused();
        verified.push({
          filename: item.filename,
          comments: "excluded by Raft preview type",
        });
        continue;
      }
      if (item.selector) await modal.locator(item.selector).click();
      else if (item.anchorType === "video-timestamp") {
        const video = modal.locator("video");
        await expect
          .poll(() => video.evaluate((v) => v.readyState))
          .toBeGreaterThanOrEqual(1);
        await video.evaluate((v) => {
          v.currentTime = 0.2;
          v.pause();
        });
        await modal
          .getByRole("button", { name: "评论当前时间", exact: true })
          .click();
      } else
        await modal.getByRole("button", { name: "评论", exact: true }).click();
      if (item.anchorType === "html-region") {
        const frame = modal.frameLocator("iframe");
        await frame
          .getByText("点击或拖动以对区域评论", { exact: true })
          .waitFor();
        const headingBox = await frame.locator("h1").boundingBox();
        await page.mouse.click(headingBox.x + 30, headingBox.y + 15);
        await expect(
          modal.locator(".rah-attachment-pending-anchor"),
        ).toContainText("HTML 区域");
      }
      const input = modal.getByRole("textbox", { name: "附件评论" });
      await input.fill("Verified **" + item.filename + "**");
      await input.press("Enter");
      await expect(input).toHaveValue("");
      await expect(
        modal.locator(".rah-attachment-comment-body strong"),
      ).toHaveText(item.filename);
      const list = await post("/v3/client/files/comments/list", {
        attachmentId: up.attachmentId,
      });
      assert.equal(list.comments.length, 1);
      assert.equal(list.comments[0].anchor?.type, item.anchorType);
      if (item.selector) {
        await modal.getByRole("button", { name: /^定位/ }).click();
        await expect(modal.locator(item.selector)).toHaveClass(
          /rah-anchor-flash/,
        );
      }
      if (item.anchorType === "html-region") {
        assert.equal(
          await page.evaluate(() => window.untrustedScriptRan),
          false,
        );
        assert.equal(
          await modal.locator("iframe").getAttribute("sandbox"),
          "allow-scripts",
        );
        assert.equal(
          await modal
            .frameLocator("iframe")
            .locator("body")
            .evaluate(() => {
              try {
                return !!parent.document;
              } catch {
                return false;
              }
            }),
          false,
        );
        const originalPending = await modal
          .locator(".rah-attachment-pending-anchor")
          .count();
        await modal.locator("iframe").evaluate((element) => {
          const channel = new DOMParser()
            .parseFromString(element.srcdoc, "text/html")
            .querySelector("script").dataset.channel;
          window.postMessage(
            {
              rahHtml: channel,
              type: "anchor",
              data: {
                x: 1,
                y: 2,
                w: 3,
                h: 4,
                viewportWidth: 800,
                documentWidth: 800,
                documentHeight: 2000,
                quote: "Forged parent",
              },
            },
            "*",
          );
        });
        await page.waitForTimeout(50);
        assert.equal(
          await modal.locator(".rah-attachment-pending-anchor").count(),
          originalPending,
        );
        assert.equal(list.comments[0].anchor.data.quote, "Sandbox content");
        const frame = modal.frameLocator("iframe");
        await frame.locator("body").evaluate(() => window.scrollTo(0, 1200));
        await modal.getByRole("button", { name: /^定位/ }).click();
        await expect(
          frame.locator("[data-rah-region-highlight]"),
        ).toBeVisible();
        await expect
          .poll(() => frame.locator("body").evaluate(() => window.scrollY))
          .toBe(0);
        await modal.getByRole("button", { name: "评论", exact: true }).click();
        await modal.getByRole("button", { name: "评论", exact: true }).click();
        await frame
          .getByText("点击或拖动以对区域评论", { exact: true })
          .waitFor();
        const box = await frame.locator("h1").boundingBox();
        await page.mouse.move(box.x + 10, box.y + 12);
        await page.mouse.down();
        await page.mouse.move(box.x + 350, box.y + 100, { steps: 5 });
        await page.mouse.up();
        await expect(
          modal.locator(".rah-attachment-pending-anchor"),
        ).toContainText("HTML 区域");
        await input.fill("Cross-paragraph persisted region");
        await input.press("Enter");
        await expect(input).toHaveValue("");
        const savedRegions = await post("/v3/client/files/comments/list", {
          attachmentId: up.attachmentId,
        });
        const region = savedRegions.comments.find((c) =>
          c.content.includes("Cross-paragraph"),
        );
        assert.ok(region.anchor.data.w > 0 && region.anchor.data.h > 0);
        assert.equal(
          region.anchor.data.quote,
          "Sandbox content ... Second ... inline ... paragraph",
        );
        await page.reload();
        await opener.click();
        await modal.getByRole("button", { name: "评论", exact: true }).click();
        await modal
          .locator(".rah-attachment-comment-card")
          .filter({ hasText: "Cross-paragraph persisted region" })
          .getByRole("button", { name: /^定位/ })
          .click();
        await expect(
          frame.locator("[data-rah-region-highlight]"),
        ).toBeVisible();
        await expect(
          frame.getByText("点击或拖动以对区域评论", { exact: true }),
        ).toBeVisible();
      }
      if (item.anchorType === "video-timestamp") {
        await modal.locator("video").evaluate((v) => (v.currentTime = 0.05));
        await modal.getByRole("button", { name: /^定位/ }).click();
        await expect
          .poll(() => modal.locator("video").evaluate((v) => v.currentTime))
          .toBeCloseTo(0.2, 1);
        assert.equal(
          await modal.locator("video").evaluate((v) => v.paused),
          true,
        );
      }
      await page.screenshot({
        path: join(
          output,
          engine + "-" + item.filename.replaceAll(".", "-") + ".png",
        ),
      });
      await modal.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(opener).toBeFocused();
      verified.push({
        filename: item.filename,
        anchorType: item.anchorType ?? "whole-file",
      });
    }
    const pagination = await verifyCommentPagination({
      page,
      post,
      head,
      attachmentId: upload.attachmentId,
      roomId,
      origin: fixture.origin,
      filename,
      output,
      engine,
    });
    assert.deepEqual(errors, []);
    results.push({
      engine,
      roomId,
      attachmentId: upload.attachmentId,
      threadId: saved.threadId,
      reloaded: true,
      verified,
      pagination,
      retryDeduplicated: true,
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
