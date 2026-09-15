import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture(),
  browser = await chromium.launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-approval-properties-`);
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(fixture.origin + "/?surface=tasks");
  const card = page.locator(".rah-global-card-open").first();
  await expect(card).toBeVisible();
  const room = await card.evaluate(
    (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
  );
  await page.goto(`${fixture.origin}/?room=${room}`);
  const badge = page.getByTestId("message-task-badge").first();
  await expect(badge).toBeVisible();
  await badge.click();
  const modal = page.getByTestId("task-thread-modal");
  await expect(modal).toBeVisible();
  const group = modal.locator(".rah-task-detail-assignment");
  await expect(group).toBeVisible();
  // Stress existing rendered controls, preserving actual layout and pointer hit targets.
  await group
    .locator("> div")
    .nth(1)
    .locator(".task-filter-trigger > span")
    .first()
    .evaluate((e) => {
      e.textContent = "这是一个非常长的负责人显示名称 Long Agent Name";
    });
  await modal.locator(".rah-task-detail-creator dd").evaluate((e) => {
    e.textContent = "这个创建人名称也很长";
  });
  let boxes = await group
    .locator("> div")
    .evaluateAll((items) =>
      items.map((e) => e.getBoundingClientRect().toJSON()),
    );
  assert.equal(boxes[0].y, boxes[1].y);
  assert.ok(boxes[1].right <= 374);
  const label = group
    .locator("> div")
    .nth(1)
    .locator(".task-filter-trigger > span")
    .first();
  assert.equal(
    await label.evaluate((e) => getComputedStyle(e).textOverflow),
    "ellipsis",
  );
  const creator = await modal.locator(".rah-task-detail-creator").boundingBox();
  assert.ok(creator.y > boxes[0].y);
  await page.screenshot({ path: `${evidence}/390-long-names.png` });
  await label.evaluate((e) => {
    e.textContent = "A";
  });
  await modal.locator(".rah-task-detail-creator dd").evaluate((e) => {
    e.textContent = "B";
  });
  boxes = await group
    .locator("> div")
    .evaluateAll((items) =>
      items.map((e) => e.getBoundingClientRect().toJSON()),
    );
  assert.equal(
    (await modal.locator(".rah-task-detail-creator").boundingBox()).y,
    boxes[0].y,
  );
  console.log(JSON.stringify({ evidence, passed: true }));
} finally {
  await browser.close();
  await fixture.close();
}
