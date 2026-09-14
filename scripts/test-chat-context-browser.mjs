import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await (
    process.env.RAH_CONTEXT_ENGINE === "webkit"
      ? webkit
      : process.env.RAH_CONTEXT_ENGINE === "firefox"
        ? firefox
        : chromium
  ).launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(12000);
  const externalEmojiRequests = [];
  await p.route("https://cdn.jsdelivr.net/**", (route) => {
    externalEmojiRequests.push(route.request().url());
    return route.abort();
  });
  await p.goto(f.origin);
  const row = p.locator(".rah-sidebar-channel-entry button").first();
  await row.click({ button: "right" });
  await p
    .getByRole("menuitem", { name: "移动到分区" })
    .waitFor({ timeout: 3000 });
  for (const name of ["标为未读", "置顶", "静音", "归档"])
    assert.equal(
      await p.getByRole("menuitem", { name, exact: true }).count(),
      1,
    );
  await p.getByRole("menuitem", { name: "置顶", exact: true }).click();
  await p.waitForTimeout(300);
  await row.click({ button: "right" });
  await p.getByRole("menuitem", { name: "取消置顶", exact: true }).waitFor();
  await p.getByRole("menuitem", { name: "移动到分区" }).hover();
  await p.getByRole("menuitem", { name: "新建分区", exact: true }).click();
  const sectionDialog = p.getByRole("dialog", { name: "新建分区" });
  assert.equal(
    await sectionDialog.evaluate((el) => getComputedStyle(el).maxWidth),
    "384px",
  );
  assert.equal(
    await sectionDialog
      .locator("header")
      .evaluate((el) => getComputedStyle(el).borderBottomWidth),
    "0px",
  );
  await sectionDialog.getByPlaceholder("我的项目").waitFor();
  assert.equal(
    await sectionDialog
      .getByRole("button", { name: "创建分区", exact: true })
      .evaluate((el) => getComputedStyle(el).opacity),
    "0.5",
  );
  await sectionDialog.getByRole("button", { name: "选择分区表情" }).click();
  const picker = p.getByRole("dialog", { name: "选择分区表情", exact: true });
  await picker.getByPlaceholder("Search").waitFor();
  await p.keyboard.press("Escape");
  assert.equal(await sectionDialog.isVisible(), true);
  await sectionDialog.getByRole("button", { name: "选择分区表情" }).click();
  await picker.getByPlaceholder("Search").fill("grinning face");
  await expect(
    picker.locator('button[data-unified="1f600"]').last(),
  ).toHaveText("😀");
  assert.deepEqual(
    externalEmojiRequests,
    [],
    "section picker works without external emoji artwork",
  );
  await p.screenshot({ path: "/tmp/rah-section-emoji-native.png" });
  await picker.locator('button[data-unified="1f600"]').last().click();
  await p.screenshot({ path: "/tmp/rah-section-desktop.png" });
  await p
    .getByRole("dialog", { name: "新建分区" })
    .getByRole("textbox")
    .fill("浏览器验证分区");
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "创建分区", exact: true })
    .click();
  await p.getByRole("dialog").waitFor({ state: "hidden" });
  await p.reload();
  await p.getByText("😀 浏览器验证分区", { exact: true }).waitFor();
  await row.click({ button: "right" });
  await p.getByRole("menuitem", { name: "归档", exact: true }).click();
  await p.getByRole("dialog").waitFor();
  await p
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await row.click({ button: "right" });
  await p.getByRole("menuitem", { name: "静音", exact: true }).click();
  await row.click({ button: "right" });
  await p.getByRole("menuitem", { name: "取消静音", exact: true }).waitFor();
  await p.keyboard.press("Escape");
  const body = p.locator(".rah-room-sidebar .sidebar-body");
  const bounds = await body.boundingBox();
  // Real pointer in the empty trailing area, not dispatching synthetic callbacks.
  await p.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height - 5,
    { button: "right" },
  );
  await p.getByRole("menuitem", { name: "创建频道", exact: true }).waitFor();
  await p.getByRole("menuitem", { name: "新建分区", exact: true }).click();
  await sectionDialog.getByRole("button", { name: "选择分区表情" }).click();
  await picker.getByPlaceholder("Search").fill("grinning face");
  await picker.locator('button[data-unified="1f600"]').last().click();
  await sectionDialog.getByRole("button", { name: "更改分区表情 😀" }).click();
  await picker.getByRole("button", { name: "不使用表情" }).click();
  await sectionDialog.getByRole("button", { name: "选择分区表情" }).waitFor();
  await sectionDialog.getByPlaceholder("我的项目").fill("保留失败草稿");
  await p.route("**/sidebar/patch", (r) =>
    r.fulfill({
      status: 503,
      json: { error: { message: "isolated failure" } },
    }),
  );
  await sectionDialog
    .getByRole("button", { name: "创建分区", exact: true })
    .click();
  await sectionDialog.getByRole("alert").waitFor();
  assert.equal(
    await sectionDialog.getByPlaceholder("我的项目").inputValue(),
    "保留失败草稿",
  );
  await p.unroute("**/sidebar/patch");
  await p.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    (await sectionDialog.boundingBox()).height < 350,
    "compact modal stays compact on mobile",
  );
  await p.screenshot({ path: "/tmp/rah-section-mobile.png" });
  await sectionDialog
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await p.setViewportSize({ width: 1440, height: 900 });
  const dm = p.locator(".rah-direct-room-row").first();
  const dmLabel = await dm.getAttribute("aria-label");
  await dm.click();
  await p.waitForTimeout(250);
  await p
    .getByRole("button", { name: dmLabel, exact: true })
    .click({ button: "right" });
  assert.equal(
    await p.getByRole("menuitem", { name: "静音", exact: true }).count(),
    0,
  );
  assert.equal(
    await p.getByRole("menuitem", { name: "归档", exact: true }).count(),
    0,
  );
  await p.getByRole("menuitem", { name: "关闭会话", exact: true }).click();
  await p
    .getByRole("button", { name: dmLabel, exact: true })
    .waitFor({ state: "hidden" });
  await p.reload();
  await p.locator(".rah-sidebar-channel-entry button").first().waitFor();
  assert.equal(
    await p.getByRole("button", { name: dmLabel, exact: true }).count(),
    0,
  );
  await p.screenshot({ path: "/tmp/rah-chat-context.png" });
  console.log("chat context persistence passed");
} finally {
  await b.close();
  await f.close();
}
