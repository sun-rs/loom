import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = process.env.RAH_TASK_AMEND_EVIDENCE;
if (!output) throw new Error("RAH_TASK_AMEND_EVIDENCE is required");
mkdirSync(output, { recursive: true });
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const results = [];
// Isolated real daemon + browser: the write uses the new authenticated Human
// API. No invented Web edit control and no requests to the formal workbench.
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page.locator(".rah-global-card-open").filter({
      hasText: "Keep the Room-first delivery contract stable",
    });
    await expect(card).toBeVisible();
    const { taskId, roomId } = await card.evaluate((element) => ({
      taskId: element.closest("[data-task-id]").dataset.taskId,
      roomId: element.closest("[data-task-room-id]").dataset.taskRoomId,
    }));
    await card.click();
    const post = async (path, data) => {
      const response = await page.request.post(fixture.origin + path, { data });
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const sync = await post("/v3/client/rooms/sync", {
      roomId,
      consumerId: "task-amend-browser",
      bootstrap: "latest",
    });
    const title = `Verified amendment ${engine}`;
    const description = "Exact acceptance criteria\nSecond line";
    const amended = await post("/v3/client/tasks/amend", {
      taskId,
      title,
      description,
      basedOnRoomSeq: sync.latestRoomSeq,
      idempotencyKey: `browser-amend-${engine}`,
    });
    assert.equal(amended.task.title, title);
    const modal = page.getByTestId("task-thread-modal");
    await expect(
      modal.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      modal.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    const history = await post("/v3/client/tasks/history", { roomId, taskId });
    assert.equal(history.events[0].type, "task.amended");
    assert.equal(history.events[0].changes.title.to, title);
    assert.equal(history.events[0].changes.description.to, description);
    await expect(
      modal.locator(".rah-task-status-picker button").first(),
    ).toBeEnabled();
    await expect(
      modal.getByRole("button", { name: /^任务负责人：/ }),
    ).toBeEnabled();
    await page.screenshot({
      path: join(output, `${engine}-amended-reloaded.png`),
    });
    assert.deepEqual(errors, []);
    results.push({ engine, taskId, roomId, title, reloaded: true, errors });
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
