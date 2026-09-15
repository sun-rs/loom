import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}&roomTab=tasks`);
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建任务" });
  await dialog
    .getByRole("textbox", { name: "任务 1", exact: true })
    .fill("FAKE retry first");
  await dialog.getByRole("button", { name: "再加一条", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "任务 2", exact: true })
    .fill("FAKE retry second");
  const requests = [];
  let lose = true;
  await page.route("**/v3/client/tasks/create", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    if (input.title === "FAKE retry second" && lose) {
      lose = false;
      await route.fulfill({
        status: 503,
        json: { error: "FAKE lost receipt after acceptance" },
      });
    } else await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "创建 2 个任务", exact: true })
    .click();
  const retry = dialog.getByRole("button", {
    name: "重试剩余 1 个任务",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await expect(
    dialog.getByRole("textbox", { name: "任务 1", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("textbox", { name: "任务 2", exact: true }),
  ).toBeDisabled();
  await retry.click();
  await expect(dialog).toBeHidden();
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[1], requests[2]);
  for (const input of requests) {
    assert.equal(input.assigneeId, undefined);
    assert.deepEqual(input.dependencyTaskIds, []);
  }
  const result = await page.request.post(
    `${fixture.origin}/v3/client/tasks/list`,
    { data: { roomId: fixture.roomId } },
  );
  const tasks = (await result.json()).tasks;
  for (const title of ["FAKE retry first", "FAKE retry second"])
    assert.equal(tasks.filter((t) => t.title === title).length, 1);
  console.log(
    "PASS title-only multi-create lost receipt retry: original idempotency, frozen titles, two canonical tasks",
  );
} finally {
  await browser.close();
  await fixture.close();
}
