import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_IDENTITY = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data) => {
    const response = await page.request.post(
      `${fixture.origin}/v3/client/${path}`,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const head = async (roomId = workspace.controlRoomId) =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "identity-gate",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const old = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents[0];
  const agentId = old.definition.agentId;
  const rooms = (
    await post("rooms/list", { workspaceId: workspace.workspaceId })
  ).rooms;
  let room, task;
  for (const candidate of rooms) {
    const found = (
      await post("tasks/list", { roomId: candidate.roomId })
    ).tasks.find((t) => t.title === "FAKE historical identity task");
    if (found) {
      room = candidate;
      task = found;
      break;
    }
  }
  assert.ok(task);
  const badge = page
    .getByTestId("message-task-badge")
    .filter({ hasText: `#${task.taskNumber}` });
  const modal = page.getByTestId("task-thread-modal");
  const detail = await post("agents/get", { agentId });
  await post("agents/manage", {
    action: "update_profile",
    agentId,
    expectedRevisionId: detail.agent.currentRevision.agentDefinitionRevisionId,
    basedOnRoomSeq: await head(),
    field: "displayName",
    value: "Gemini Identity Fixture",
    idempotencyKey: crypto.randomUUID(),
  });
  await page.goto(`${fixture.origin}/?room=${room.roomId}`);
  await expect(badge).toContainText("@Gemini Identity Fixture");
  await post("tasks/workflow", {
    taskId: task.taskId,
    workflowStatus: "closed",
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: crypto.randomUUID(),
  });
  await post("agents/manage", {
    action: "set_state",
    state: "tombstoned",
    agentId,
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const deletedTask = (
    await post("tasks/get", { roomId: room.roomId, taskId: task.taskId })
  ).task;
  assert.equal(deletedTask.assigneeId, undefined);
  assert.equal(deletedTask.workflowStatus, "closed");
  for (const width of [1440, 1000, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${fixture.origin}/?room=${room.roomId}`);
    await expect(badge).not.toContainText(old.handle);
    await badge.click();
    await expect(modal.getByTestId("task-detail-metadata")).toContainText(
      "未指派",
    );
    // Narrow approval keeps its metadata-only compact presentation.
    if (width >= 768) {
      await expect(
        modal.locator(".rah-agent-deleted-badge").first(),
      ).toBeVisible();
      await expect(
        modal.locator(".rah-message-avatar-trigger .rah-agent-avatar").first(),
      ).toHaveCSS("filter", "grayscale(1)");
      await expect(
        modal
          .locator(".msg-head")
          .filter({ hasText: "Gemini Identity Fixture" })
          .first(),
      ).toBeVisible();
    }
    if (width >= 768) {
      const fits = async () =>
        modal.evaluate((el) => {
          const thread = el.querySelector(".thread-side-column");
          return (
            Math.abs(thread.getBoundingClientRect().width - el.clientWidth) < 2
          );
        });
      await expect
        .poll(fits, { message: "chat approval discussion fills its modal" })
        .toBe(true);
      await page.goto(
        `${fixture.origin}/?surface=tasks&target=task&room=${room.roomId}&task=${task.taskId}`,
      );
      await expect(modal).toBeVisible();
      await expect
        .poll(fits, { message: "global task discussion fills its modal" })
        .toBe(true);
      await expect(
        modal.locator(".rah-agent-deleted-badge").first(),
      ).toBeVisible();
      await expect(
        modal
          .locator(".msg-head")
          .filter({ hasText: "Gemini Identity Fixture" })
          .first(),
      ).toBeVisible();
    }
    await page.screenshot({
      path: `/tmp/rah-deleted-task-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
    });
  }
  await post("tasks/workflow", {
    taskId: task.taskId,
    workflowStatus: "todo",
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: crypto.randomUUID(),
  });
  await post("threads/reply", {
    roomId: room.roomId,
    threadId: task.threadId,
    body: "FAKE avatar navigation reply",
    recipientIds: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: crypto.randomUUID(),
  });
  // Cold PWA entry through Tasks must keep avatar navigation inside approval.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", { value: true }),
    );
    await page.goto(`${fixture.origin}/?surface=tasks`);
    await page.reload();
    await page
      .locator(".rah-global-card-open")
      .filter({ hasText: task.title })
      .first()
      .click();
    await expect(modal).toBeVisible();
    await expect(
      modal.getByText("FAKE avatar navigation reply", { exact: true }),
    ).toBeVisible();
    const composer = modal.locator("textarea").last();
    await composer.fill("FAKE preserved approval draft");
    const discussion = await modal
      .locator(".thread-side-column")
      .elementHandle();
    await modal
      .locator(".rah-message-avatar-trigger")
      .filter({
        has: page.locator(".rah-agent-avatar"),
      })
      .first()
      .click();
    await expect(modal.locator(".rah-agent-unavailable")).toBeVisible();
    const unavailable = modal.locator(".rah-agent-unavailable");
    await expect(unavailable.locator("header h2")).toHaveCSS(
      "font-size",
      "16px",
    );
    await expect(unavailable.locator("header h2")).toHaveCSS(
      "line-height",
      "20px",
    );
    await expect(unavailable.locator(".rah-panel-header-icon")).toHaveCSS(
      "background-color",
      /\boklch\(0\.928 0\.006 264\.531\d*\)/,
    );
    await page.keyboard.press("Tab");
    await expect(
      modal.getByRole("button", {
        name: "返回审批",
        exact: true,
      }),
    ).toBeFocused();
    // Exercise the dialog's explicit reverse wrap, independent of Safari's
    // platform preference for skipping buttons in native forward traversal.
    await page.keyboard.press("Shift+Tab");
    await expect(
      modal.getByRole("button", {
        name: width < 768 ? "返回审批" : "关闭任务详情",
        exact: true,
      }),
    ).toBeFocused();
    await page.screenshot({
      path: `/tmp/task-avatar-unavailable-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
    });
    await modal
      .getByRole("button", {
        name: "返回审批",
        exact: true,
      })
      .click();
    await expect(modal.getByTestId("task-detail-metadata")).toBeVisible();
    await expect(composer).toHaveValue("FAKE preserved approval draft");

    await modal
      .locator(".rah-message-avatar-trigger")
      .filter({ hasNot: page.locator(".rah-agent-avatar") })
      .first()
      .click();
    await expect(modal.locator(".rah-agent-directory-page")).toBeVisible();
    await expect(page.locator(".rah-error-boundary")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(modal.getByTestId("task-detail-metadata")).toBeVisible();
    assert.equal(
      await discussion.evaluate(
        (node) => node.isConnected && node.getClientRects().length > 0,
      ),
      true,
      "original discussion stays mounted through profiles",
    );
    if (width >= 768) {
      await modal
        .locator(".rah-message-avatar-trigger")
        .filter({ has: page.locator(".rah-agent-avatar") })
        .first()
        .click();
      await expect(
        modal.getByRole("button", { name: "返回审批", exact: true }),
      ).toBeVisible();
      await modal
        .getByRole("button", { name: "关闭任务详情", exact: true })
        .click();
      await expect(modal).toHaveCount(0);
      await page
        .locator(".rah-global-card-open")
        .filter({ hasText: task.title })
        .first()
        .click();
      await expect(modal.getByTestId("task-detail-metadata")).toBeVisible();
      await expect(modal.locator(".rah-task-modal-profile")).toHaveCount(0);
    }
    await expect(page).toHaveURL(/surface=tasks/);
    await modal
      .getByRole("button", {
        name: width < 768 ? "返回任务页面" : "关闭任务详情",
        exact: true,
      })
      .click();
    await expect(modal).toHaveCount(0);
  }
  console.log(
    "Renamed task chip, deleted historical reply/avatar, unassigned closed task and reload verified",
  );
} finally {
  await browser.close();
  await fixture.close();
}
