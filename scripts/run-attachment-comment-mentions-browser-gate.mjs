import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = process.env.RAH_ATTACHMENT_COMMENTS_EVIDENCE;
if (!output) throw new Error("evidence directory required");
mkdirSync(output, { recursive: true });
process.env.RAH_FIXTURE_KEEP_STATE = "1";
const results = [];
for (const engine of (
  process.env.RAH_COMMENT_ENGINES ?? "chrome,firefox"
).split(",")) {
  const fixture = await startShellFixture(),
    browser = await (engine === "chrome" ? chromium : firefox).launch({
      headless: true,
      ...(engine === "chrome"
        ? { executablePath: await findChromeExecutable() }
        : {}),
    });
  let db;
  try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      }),
      roomId = fixture.roomId;
    const post = async (path, data) => {
      const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
        data,
      });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const head = async () =>
      (
        await post("rooms/sync", {
          roomId,
          consumerId: "mention-browser",
          bootstrap: "latest",
        })
      ).latestRoomSeq;
    const filename = "Mention review.txt",
      bytes = Buffer.from("Review this published file.");
    const file = await post("files/prepare", {
      roomId,
      filename,
      mimeType: "text/plain",
      size: bytes.length,
      idempotencyKey: "mentions-file",
    });
    const put = await page.request.put(
      fixture.origin + "/v3/client/files/content/" + file.attachmentId,
      { data: bytes, headers: { "content-type": "application/octet-stream" } },
    );
    assert.equal(put.status(), 200);
    await post("messages/post", {
      roomId,
      body: "Attachment mention fixture",
      attachmentIds: [file.attachmentId],
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "mentions-publish",
    });
    db = new DatabaseSync(join(fixture.stateDirectory, "room.db"), {
      readOnly: true,
    });
    const agent = db
      .prepare(
        "SELECT p.principal_id,p.handle FROM principals p JOIN memberships m ON m.principal_id=p.principal_id WHERE m.room_id=? AND p.kind='agent' ORDER BY p.handle LIMIT 1",
      )
      .get(roomId);
    assert.ok(agent);
    await page.goto(fixture.origin + "/?room=" + roomId);
    await page.locator(".rah-file-open").filter({ hasText: filename }).click();
    const dialog = page.getByRole("dialog", { name: "预览 " + filename });
    await dialog.getByRole("button", { name: "评论", exact: true }).click();
    const input = dialog.getByRole("textbox", { name: "附件评论" });
    await input.fill("@" + agent.handle.slice(0, 2));
    await input.press("End");
    const choice = dialog
      .getByRole("option")
      .filter({ hasText: "@" + agent.handle });
    await expect(choice).toBeVisible({ timeout: 3000 });
    await choice.click();
    await expect(input).toHaveValue("@" + agent.handle + " ");
    await input.fill("@" + agent.handle + " Please review this file.");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    await expect(input).toHaveValue(
      "@" + agent.handle + " Please review this file.",
    );
    assert.equal(
      (await post("files/comments/list", { attachmentId: file.attachmentId }))
        .comments.length,
      0,
    );
    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/files/comments/post") && r.status() === 200,
    );
    await input.press("Enter");
    const receipt = await (await sent).json();
    await expect(input).toHaveValue("");
    const inbox = db
      .prepare(
        "SELECT participant_id,event_id,event_seq,state FROM inbox_items WHERE event_id=?",
      )
      .all(receipt.event.eventId);
    assert.ok(
      inbox.some((r) => r.participant_id === agent.principal_id),
      JSON.stringify(inbox),
    );
    assert.deepEqual(receipt.event.payload.requestedRecipientIds, [
      agent.principal_id,
    ]);

    await page.screenshot({
      path: join(output, engine + "-mention-delivered.png"),
    });
    // A different file owns a different mounted draft and read scope. Hold the old
    // canonical read until after the next file has loaded, then release it.
    const secondBytes = Buffer.from("Other attachment content"),
      second = await post("files/prepare", {
        roomId,
        filename: "Other comment.txt",
        mimeType: "text/plain",
        size: secondBytes.length,
        idempotencyKey: "second-comment-file",
      });
    await page.request.put(
      fixture.origin + "/v3/client/files/content/" + second.attachmentId,
      {
        data: secondBytes,
        headers: { "content-type": "application/octet-stream" },
      },
    );
    await post("messages/post", {
      roomId,
      body: "Other attachment fixture",
      attachmentIds: [second.attachmentId],
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: "second-comment-publish",
    });
    let release, started;
    const held = new Promise((resolve) => (release = resolve)),
      readStarted = new Promise((resolve) => (started = resolve));
    await page.route("**/v3/client/files/comments/list", async (route) => {
      if (route.request().postDataJSON().attachmentId !== file.attachmentId) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      started();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await readStarted;
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await page
      .locator(".rah-file-open")
      .filter({ hasText: "Other comment.txt" })
      .click();
    const other = page.getByRole("dialog", { name: "预览 Other comment.txt" });
    await other.getByRole("button", { name: "评论", exact: true }).click();
    await expect(other.getByText("暂无评论", { exact: true })).toBeVisible();
    const otherInput = other.getByRole("textbox", { name: "附件评论" });
    await otherInput.fill("New file draft remains");
    release();
    await expect(otherInput).toHaveValue("New file draft remains");
    await expect(other.getByText("暂无评论", { exact: true })).toBeVisible();
    await expect(other.locator(".rah-attachment-comment-card")).toHaveCount(0);
    await page.unroute("**/v3/client/files/comments/list");
    await other.getByRole("button", { name: "评论", exact: true }).click();
    await other.getByRole("button", { name: "评论", exact: true }).click();
    await expect(otherInput).toHaveValue("New file draft remains");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, engine + "-late-file-draft-mobile.png"),
    });
    results.push({
      engine,
      agent: agent.handle,
      commentEventId: receipt.event.eventId,
      inbox,
      imePrevented: true,
      lateFileResponseIsolated: true,
    });
  } finally {
    db?.close();
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "mention-results.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
