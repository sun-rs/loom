import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let state = "in_progress";
  let presentationTask;
  // Presentation fixture: change only canonical Task-shaped responses, never messages or events.
  await page.route("**/v3/client/**", async (route) => {
    const response = await route.fetch();
    if (!response.headers()["content-type"]?.includes("application/json"))
      return route.fulfill({ response });
    const data = await response.json();
    if (
      route.request().url().includes("/activity/list") &&
      data.items?.[0] &&
      presentationTask
    )
      data.items[0].task = structuredClone(presentationTask);
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (
        value.taskId &&
        value.taskNumber &&
        value.sourceMessageId &&
        value.state
      ) {
        value.state = state;
        delete value.workflowStatus;
        for (const key of [
          "claimedBy",
          "claimUntil",
          "completedAt",
          "cancelledAt",
          "cancellationReason",
          "blockedAt",
          "blockedReason",
        ])
          delete value[key];
        value.assigneeId = "fixture-agent";
        value.collaboratorIds = [];
        value.reviewerIds = [];
        if (state === "in_progress") {
          value.claimedBy = value.assigneeId;
          value.claimUntil = "2099-01-01T00:00:00.000Z";
        }
        if (state === "submitted" || state === "completed") {
          value.submissionSummary = "Presentation fixture";
          value.submittedAt = value.createdAt;
        }
        if (state === "completed") value.completedAt = value.createdAt;
        presentationTask = structuredClone(value);
      }
      for (const child of Object.values(value)) visit(child);
    };
    visit(data);
    await route.fulfill({ response, json: data });
  });
  await page.goto(fixture.origin + "/?surface=tasks");
  const card = page.locator(".rah-global-card-open").first();
  await expect(card).toBeVisible();
  const roomId = await card.evaluate(
    (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
  );
  await page.goto(fixture.origin + "/?room=" + roomId);
  const badge = page.getByTestId("message-task-badge").first();
  await expect(badge).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  await composer.fill("TASK_COLOR_FIXTURE task #1");
  await composer.press("Enter");
  const inline = page
    .locator(".rah-rich-task-reference[data-task-status]")
    .last();
  await expect(inline).toBeVisible();
  const colors = [];
  for (const [next, id, variable] of [
    ["in_progress", "in-progress", "--cyan"],
    ["submitted", "review", "--lavender"],
    ["completed", "done", "--green"],
  ]) {
    state = next;
    await expect(badge).toHaveAttribute("data-task-status", id, {
      timeout: 15000,
    });
    const color = await badge.evaluate((e, variable) => {
      const sample = document.createElement("i");
      sample.style.background = `var(${variable})`;
      e.append(sample);
      const expected = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return { actual: getComputedStyle(e).backgroundColor, expected };
    }, variable);
    assert.equal(color.actual, color.expected);
    colors.push(color.actual);
    await expect(inline).toHaveAttribute("data-task-status", id, {
      timeout: 15000,
    });
    assert.equal(
      await inline.evaluate((e) => getComputedStyle(e).backgroundColor),
      color.expected,
    );
  }
  assert.equal(new Set(colors).size, 3);
  await page.screenshot({ path: "/tmp/rah-task-colors-chat.png" });
  await badge.click();
  const reply = page.getByRole("textbox", { name: "Thread 回复输入框" });
  await expect(reply).toBeEnabled();
  await reply.fill("TASK_COLOR_FIXTURE thread reply");
  await reply.press("Enter");
  await expect(page.getByTestId("task-thread-modal")).toContainText(
    "TASK_COLOR_FIXTURE thread reply",
  );
  await page.goto(fixture.origin + "/?surface=activity");
  const activity = page.locator(".activity-chip[data-task-status]").first();
  await expect(activity).toBeVisible();
  state = "submitted";
  await expect(activity).toHaveAttribute("data-task-status", "review", {
    timeout: 15000,
  });
  state = "completed";
  await expect(activity).toHaveAttribute("data-task-status", "done", {
    timeout: 15000,
  });
  await page.screenshot({ path: "/tmp/rah-task-colors-activity.png" });
  console.log("Task badge follows refreshed canonical state without reload");
} finally {
  await browser.close();
  await fixture.close();
}
