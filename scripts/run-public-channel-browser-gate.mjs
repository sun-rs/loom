import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import {
  snapshotUiEvidenceInputs,
  assertUiEvidenceInputSnapshot,
  uiContractEvidenceInputPaths,
} from "./ui-evidence-inputs.mjs";
const evidenceOptions = { extraPaths: uiContractEvidenceInputPaths() };
const inputs = snapshotUiEvidenceInputs(evidenceOptions);
const output = mkdtempSync(join(tmpdir(), "rah-public-channel-")),
  results = [];
for (const engine of process.env.RAH_UI_BROWSER
  ? [process.env.RAH_UI_BROWSER]
  : ["chrome", "firefox"]) {
  const fixture = await startShellFixture({ humanMatrix: true });
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  let page;
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    const post = async (path, data) => {
      const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
        data,
      });
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const seq = async (roomId) =>
      (
        await post("rooms/sync", {
          roomId,
          consumerId: "public-gate",
          bootstrap: "latest",
          limit: 1,
        })
      ).latestRoomSeq;
    const people = (
      await post("workspaces/humans", { workspaceId: workspace.workspaceId })
    ).humans;
    const peer = people.find((p) => p.principal.handle === "fixture-coowner");
    assert.ok(peer);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const room = (
        await post("rooms/create", {
          workspaceId: workspace.workspaceId,
          kind: "channel",
          name: `Public ${engine} ${width}`,
          slug: `public-${engine}-${width}`,
          visibility: "public",
          basedOnControlRoomSeq: await seq(workspace.controlRoomId),
          idempotencyKey: crypto.randomUUID(),
        })
      ).room;
      await post("rooms/members/role", {
        roomId: room.roomId,
        principalId: peer.principal.principalId,
        role: "owner",
        basedOnRoomSeq: await seq(room.roomId),
        idempotencyKey: crypto.randomUUID(),
      });
      await post("messages/post", {
        roomId: room.roomId,
        body: "Public preview content",
        basedOnRoomSeq: await seq(room.roomId),
        idempotencyKey: crypto.randomUUID(),
      });
      const publicTask = (
        await post("tasks/create", {
          roomId: room.roomId,
          title: "Public readable task",
          basedOnRoomSeq: await seq(room.roomId),
          idempotencyKey: crypto.randomUUID(),
        })
      ).task;
      await post("rooms/leave", {
        roomId: room.roomId,
        basedOnRoomSeq: await seq(room.roomId),
        idempotencyKey: crypto.randomUUID(),
      });
      await page.goto(
        fixture.origin + "/?surface=search&q=" + encodeURIComponent(room.name),
      );
      const search = page.getByRole("main", { name: "全局搜索" });
      await search.waitFor();
      await search
        .getByRole("button")
        .filter({ hasText: room.name })
        .first()
        .click();
      const preview = page.getByRole("complementary", { name: "频道预览" });
      await preview.waitFor();
      assert.equal(await search.isVisible(), width !== 390);
      await preview
        .getByText("Public preview content", { exact: true })
        .waitFor();
      assert.ok(
        await preview.locator(".rah-message-avatar-trigger").count(),
        "public content reuses the canonical message presentation",
      );
      const unanswered = preview
        .locator("article")
        .filter({ hasText: "Public preview content" })
        .first();
      await unanswered.hover();
      await unanswered
        .getByRole("button", { name: "在消息列中回复", exact: true })
        .click();
      await preview
        .getByRole("region", { name: "公开消息列", exact: true })
        .getByRole("button", { name: "加入频道以回复", exact: true })
        .waitFor();
      await preview
        .getByRole("button", { name: "返回频道", exact: true })
        .click();
      await preview.getByRole("tab", { name: "任务", exact: true }).click();
      await preview
        .getByText("Public readable task", { exact: true })
        .first()
        .waitFor();
      await preview
        .getByText("Public readable task", { exact: true })
        .first()
        .click();
      assert.equal(
        await preview
          .getByRole("region", { name: "公开频道正文", exact: true })
          .isVisible(),
        width !== 390,
      );
      await preview
        .getByRole("button", { name: "返回频道", exact: true })
        .click();
      await preview.getByRole("tab", { name: "任务", exact: true }).click();
      await preview.getByRole("tab", { name: "文件", exact: true }).click();
      await preview.getByText("暂无文件", { exact: true }).waitFor();
      await page.reload();
      await preview.getByText("暂无文件", { exact: true }).waitFor();
      await preview.getByRole("tab", { name: "聊天", exact: true }).click();
      const publicMessage = preview
        .locator("article")
        .filter({ hasText: "Public preview content" })
        .first();
      await publicMessage.hover();
      await publicMessage
        .getByRole("button", { name: "收藏消息", exact: true })
        .click();
      await publicMessage
        .getByRole("button", { name: "从收藏中移除", exact: true })
        .first()
        .waitFor();
      assert.equal(
        await publicMessage
          .getByRole("button", { name: "添加回应", exact: true })
          .count(),
        0,
      );
      if (width === 390)
        assert.equal(
          await preview
            .getByRole("button", { name: "关闭频道预览" })
            .isVisible(),
          true,
          "mobile preview has a real return target",
        );
      await page.route("**/v3/client/rooms/preview", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "forbidden",
              message: "Fixture revoked public preview",
            },
          }),
        }),
      );
      await preview.getByRole("alert").waitFor();
      assert.equal(
        await preview
          .getByText("Public preview content", { exact: true })
          .count(),
        0,
        "denied refresh clears old content",
      );
      await page.unroute("**/v3/client/rooms/preview");
      await preview.getByRole("button", { name: "重试", exact: true }).click();
      await preview
        .getByText("Public preview content", { exact: true })
        .waitFor();
      if (width === 390) {
        await preview.getByRole("button", { name: "关闭频道预览" }).click();
        await search.waitFor({ state: "visible" });
      } else {
        await page.goBack();
        await search.waitFor({ state: "visible" });
      }
      assert.equal(await search.isVisible(), true);
      await page.goto(
        fixture.origin + "/?surface=search&q=Public%20preview%20content",
      );
      await search
        .getByRole("button")
        .filter({ hasText: "Public preview content" })
        .first()
        .click();
      await preview
        .getByText("Public preview content", { exact: true })
        .waitFor();
      assert.ok(new URL(page.url()).searchParams.get("previewMessage"));
      await page.reload();
      await preview
        .getByText("Public preview content", { exact: true })
        .waitFor();
      await page.goto(fixture.origin + "/?surface=saved");
      await page
        .locator(".rah-saved-pane")
        .getByRole("button")
        .filter({ hasText: "Public preview content" })
        .first()
        .click();
      await preview
        .getByText("Public preview content", { exact: true })
        .waitFor();
      const joiningRoot = preview
        .locator("article")
        .filter({ hasText: "Public preview content" })
        .first();
      await joiningRoot.hover();
      await joiningRoot
        .getByRole("button", { name: "在消息列中回复", exact: true })
        .click();
      await preview
        .getByRole("button", { name: "加入频道以回复", exact: true })
        .click();
      await page
        .getByRole("button", { name: "关闭消息列", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "关闭消息列", exact: true })
        .click();
      const composer = page.getByRole("textbox", {
        name: "消息输入框",
        exact: true,
      });
      await composer.waitFor();
      await composer.fill("Joined through public preview");
      await page.waitForFunction(() => {
        const t = document.querySelector('textarea[aria-label="消息输入框"]');
        const b = t?.closest("form")?.querySelector('button[type="submit"]');
        return b && !b.disabled;
      });
      await composer.press("Enter");
      await page
        .locator(".channel .msg-body")
        .getByText("Joined through public preview", { exact: true })
        .waitFor();
      await page.reload();
      await page
        .locator(".channel .msg-body")
        .getByText("Joined through public preview", { exact: true })
        .waitFor();
      assert.ok(
        (await post("messages/list", { roomId: room.roomId })).messages.some(
          (m) => m.body === "Joined through public preview",
        ),
      );
      await page.waitForFunction(() => {
        const input = document.querySelector(
          'textarea[aria-label="消息输入框"]',
        );
        return input && !input.disabled;
      });
      await page.screenshot({ path: join(output, `${engine}-${width}.png`) });
      await composer.focus();
      assert.equal(
        await composer.evaluate((el) => document.activeElement === el),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(await search.isVisible(), width !== 390);
      const root = (
        await post("messages/post", {
          roomId: room.roomId,
          body: `Follow after leave ${width}`,
          basedOnRoomSeq: await seq(room.roomId),
          idempotencyKey: crypto.randomUUID(),
        })
      ).event;
      const thread = (
        await post("threads/create", {
          roomId: room.roomId,
          rootMessageId: root.aggregateId,
          recipientIds: [],
          basedOnRoomSeq: await seq(room.roomId),
          idempotencyKey: crypto.randomUUID(),
        })
      ).thread;
      await post("threads/reply", {
        roomId: room.roomId,
        threadId: thread.threadId,
        body: "Thread preview reply",
        recipientIds: [],
        basedOnRoomSeq: await seq(room.roomId),
        idempotencyKey: crypto.randomUUID(),
      });
      await post("activity/follow", {
        roomId: room.roomId,
        threadId: thread.threadId,
        following: true,
      });
      await post("rooms/leave", {
        roomId: room.roomId,
        basedOnRoomSeq: await seq(room.roomId),
        idempotencyKey: crypto.randomUUID(),
      });
      await page.goto(fixture.origin + "/?surface=activity");
      const activity = page.getByRole("main", { name: "全局动态" });
      await activity
        .locator(".rah-activity-open")
        .filter({ hasText: `Follow after leave ${width}` })
        .click();
      await preview
        .getByText("Thread preview reply", { exact: true })
        .waitFor();
      assert.equal(await composer.count(), 0, "nonmember Thread cannot send");
      await preview
        .getByRole("button", { name: "取消关注", exact: true })
        .click();
      await preview
        .getByRole("button", { name: "关注", exact: true })
        .waitFor();
      await preview.getByRole("button", { name: "关注", exact: true }).click();
      await preview
        .getByRole("button", { name: "取消关注", exact: true })
        .waitFor();
      await page.reload();
      await preview
        .getByText("Thread preview reply", { exact: true })
        .waitFor();
      await page.screenshot({
        path: join(output, `${engine}-${width}-follow.png`),
      });
      results.push({ engine, width, status: "passed" });
    }
  } catch (e) {
    if (page)
      await page.screenshot({ path: join(output, `${engine}-failure.png`) });
    console.error(output);
    throw e;
  } finally {
    await browser.close();
    await fixture.close();
  }
}
assertUiEvidenceInputSnapshot(inputs, evidenceOptions);
writeFileSync(
  join(output, "receipt.json"),
  JSON.stringify({ output, inputs, results }, null, 2),
);
console.log(JSON.stringify({ output, results }));
