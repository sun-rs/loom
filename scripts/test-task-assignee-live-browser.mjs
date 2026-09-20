import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(
    `${fixture.origin}/?surface=settings&settingsSection=account`,
  );
  await page
    .getByRole("textbox", { name: "显示名称", exact: true })
    .fill("Assignee Display");
  const saved = page.waitForResponse((r) =>
    r.url().endsWith("/principals/update"),
  );
  await page.getByRole("button", { name: "保存资料", exact: true }).click();
  await saved;
  await page.goto(`${fixture.origin}/?surface=tasks`);
  const card = page
    .locator(".rah-global-card-open")
    .filter({ hasText: "Keep the Room-first delivery contract" })
    .first();
  await expect(card).toBeVisible();
  const roomId = await card.evaluate(
    (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
  );
  await page.goto(`${fixture.origin}/?room=${roomId}`);
  const badge = page
    .getByTestId("message-task-badge")
    .filter({ hasText: "#1" })
    .first();
  await expect(badge).toBeVisible();
  await badge.click();
  const modal = page.getByTestId("task-thread-modal");
  const assignee = modal.getByRole("button", { name: /^任务负责人：/ });
  const choosePerson = async (name) => {
    await assignee.click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await expect(assignee).toHaveText(name);
  };
  await choosePerson("Assignee Display");
  await expect(badge).toContainText("@Assignee Display", { timeout: 1000 });
  await choosePerson("未指派");
  await expect(badge).not.toContainText("@", { timeout: 1000 });
  const status = modal.getByRole("button", { name: /^任务 #\d+ 状态：/ });
  await status.click();
  await page
    .getByRole("menuitemradio", { name: "进行中", exact: true })
    .click();
  await expect(status).toHaveText("进行中");
  await expect(badge).toContainText("@Assignee Display", { timeout: 1000 });
  await choosePerson("Alice");
  await expect(badge).toContainText("@Alice", { timeout: 1000 });

  // All non-done workflow states retain the assignee editor, including closed.
  for (const label of ["进行中", "待确认", "已关闭", "待办", "完成"]) {
    await status.click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await expect(status).toHaveText(label);
    if (label !== "完成") await expect(assignee).toBeEnabled();
  }
  await expect(assignee).toBeDisabled();
  await assignee.locator("..").hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "已完成的任务不能更换负责人，请先重新打开任务。",
  );
  // The tooltip must paint above the modal, not merely exist in the DOM.
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1");
  const layers = await page.evaluate(() => ({
    tooltip: Number(
      getComputedStyle(document.querySelector(".rah-tooltip-positioner"))
        .zIndex,
    ),
    modal: Number(
      getComputedStyle(document.querySelector(".rah-task-detail-layer")).zIndex,
    ),
  }));
  expect(layers.tooltip).toBeGreaterThan(layers.modal);
  await page.screenshot({
    path: `/tmp/rah-assignee-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await status.click();
  await page.getByRole("menuitemradio", { name: "待办", exact: true }).click();
  await expect(assignee).toBeEnabled();
  await choosePerson("未指派");
  await expect(badge).not.toContainText("@", { timeout: 1000 });
  console.log(
    "Human/Agent display names update task badge on assign/unassign; done blocks editor with tooltip; other statuses editable",
  );
} finally {
  await browser.close();
  await fixture.close();
}
