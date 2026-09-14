import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const f = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const p = await browser.newPage({
    viewport: {
      width: Number(process.env.RAH_VIEWPORT_WIDTH ?? 1440),
      height: 900,
    },
  });
  p.setDefaultTimeout(10000);
  let excluded;
  await p.route("**/v3/client/agents/list", async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    excluded = data.agents.find((a) => a.handle.toLowerCase().includes("kimi"))
      ?.definition.participantId;
    await route.fulfill({ response: r });
  });
  await p.route("**/v3/client/rooms/members/list", async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    await route.fulfill({
      json: {
        ...data,
        memberships: data.memberships.filter((m) => m.principalId !== excluded),
      },
    });
  });
  await p.goto(f.origin + "/?surface=settings&settingsSection=account");
  await p
    .getByRole("textbox", { name: "显示名称", exact: true })
    .fill("Timeline Human");
  const saved = p.waitForResponse((r) =>
    r.url().endsWith("/principals/update"),
  );
  await p.getByRole("button", { name: "保存资料", exact: true }).click();
  assert.equal((await saved).status(), 200);
  await p.goto(f.origin + "/?surface=tasks");
  await p
    .locator(".rah-global-card-open")
    .filter({ hasText: "Keep the Room-first delivery" })
    .click();
  const modal = p.getByTestId("task-thread-modal");
  await modal.waitFor();
  assert.equal(
    await modal
      .locator(".rah-task-detail-properties > div")
      .filter({ hasText: "创建人" })
      .locator("dd")
      .innerText(),
    "Timeline Human",
  );
  await modal.getByRole("button", { name: /^任务负责人：/ }).click();
  assert.equal(
    await p.getByRole("menuitemradio", { name: "Kimi", exact: true }).count(),
    0,
    "nonmember cannot be an assignee candidate",
  );
  const options = p.locator(
    ".is-task-assignee .rah-discovery-popover-options > button",
  );
  const unassigned = options.filter({ hasText: "未指派" });
  const person = options.filter({ hasText: "Alice" });
  const label = (option) =>
    option.locator(":scope > span:not(.rah-discovery-option-leading)");
  assert.equal(
    (await label(unassigned).boundingBox()).x,
    (await label(person).boundingBox()).x,
  );
  assert.deepEqual(
    await unassigned.evaluate((e) => ({
      size: getComputedStyle(e).fontSize,
      weight: getComputedStyle(e).fontWeight,
      height: e.getBoundingClientRect().height,
    })),
    { size: "12px", weight: "700", height: 36 },
  );
  assert.deepEqual(
    await modal
      .locator(".rah-task-detail-properties dt")
      .first()
      .evaluate((e) => ({
        size: getComputedStyle(e).fontSize,
        weight: getComputedStyle(e).fontWeight,
        color: getComputedStyle(e).color,
      })),
    { size: "12px", weight: "400", color: "rgba(0, 0, 0, 0.5)" },
  );
  await p.screenshot({ path: "/tmp/rah-task-assignee-style.png" });
  await p.keyboard.press("Escape");
  const composer = modal.getByRole("textbox", { name: "Thread 回复输入框" });
  await composer.fill(
    Array.from({ length: 35 }, (_, i) => `Fixture long task reply ${i}`).join(
      "\n",
    ),
  );
  await composer.press("Enter");
  await modal
    .getByText("Fixture long task reply 34", { exact: false })
    .first()
    .waitFor();
  await modal
    .getByRole("button", { name: "关闭任务详情", exact: true })
    .click();
  await p
    .locator(".rah-global-card-open")
    .filter({ hasText: "Keep the Room-first delivery" })
    .click();
  const scroller = modal.locator(".rah-thread-task-body");
  await p.waitForFunction(() => {
    const e = document.querySelector(".rah-thread-task-body");
    return e && e.scrollHeight - e.scrollTop - e.clientHeight < 3;
  });
  await scroller.evaluate((e) => {
    e.style.maxHeight = `${e.clientHeight - 120}px`;
  });
  await scroller
    .locator(".msg")
    .last()
    .evaluate((e) => {
      const late = document.createElement("div");
      late.style.height = "120px";
      late.dataset.fixtureLateContent = "true";
      e.append(late);
    });
  await p.waitForFunction(() => {
    const e = document.querySelector(".rah-thread-task-body");
    return e && e.scrollHeight - e.scrollTop - e.clientHeight < 2;
  });
  await scroller.click({ position: { x: 8, y: 8 } });
  await scroller.evaluate((e) => {
    e.scrollTop = 0;
  });
  await scroller.locator("[data-fixture-late-content]").evaluate((e) => {
    e.style.height = "200px";
  });
  await scroller.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    await scroller.evaluate((e) => e.scrollTop),
    0,
    "layout growth after user interaction must not pull the reader down",
  );
  await modal.getByRole("button", { name: "操作时间线", exact: true }).click();
  await modal.locator(".rah-task-detail-history-body li").first().waitFor();
  assert.equal(
    (await modal.locator(".rah-task-history-dot").count()) > 0,
    true,
  );
  assert.ok(
    (await modal.locator(".rah-task-history-meta").allTextContents()).some(
      (text) => text.includes("Timeline Human"),
    ),
  );
  await p.screenshot({ path: "/tmp/rah-task-history.png" });
  for (const selector of [".rah-thread-beginning", ".rah-thread-divider"]) {
    assert.deepEqual(
      await modal.locator(selector).evaluate((e) => ({
        size: getComputedStyle(e).fontSize,
        line: getComputedStyle(e).lineHeight,
        weight: getComputedStyle(e).fontWeight,
      })),
      { size: "12px", line: "16px", weight: "400" },
    );
  }
  console.log(
    "Task member candidates, latest reply on reopen and operation timeline passed",
  );
} finally {
  await browser.close();
  await f.close();
}
