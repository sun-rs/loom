import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(fixture.origin);
  const input = page.getByRole("textbox", { name: "消息输入框", exact: true });
  await input.waitFor();
  if (!(await page.getByLabel("作为任务", { exact: true }).isChecked()))
    await page.locator("label.task-check").click();
  assert.equal(await page.getByText("任务负责人", { exact: true }).count(), 0);
  await input.fill("@fixture-agent 环境变量任务测试");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v3/client/tasks/create") &&
      r.request().method() === "POST",
  );
  await page.locator(".send-btn").click();
  const saved = await response;
  assert.equal(saved.status(), 200);
  const payload = saved.request().postDataJSON();
  assert.equal(payload.title, "@fixture-agent 环境变量任务测试");
  assert.equal(payload.assigneeId, undefined);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (!(await page.getByLabel("作为任务", { exact: true }).isChecked()))
      await page.locator("label.task-check").click();
    assert.equal(
      await page.getByText("任务负责人", { exact: true }).count(),
      0,
    );
    await page.screenshot({ path: `/tmp/rah-task-toggle-${width}.png` });
  }
  console.log(
    "Composer task toggle has no owner region; canonical task creation and mention text preserved; desktop/mobile passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
