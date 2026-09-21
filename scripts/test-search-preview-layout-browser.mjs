import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const b = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(10000);
  await p.goto(f.origin + "/?surface=search&q=History");
  const hit = p.locator(".rah-search-hit").first();
  await expect(hit.locator("mark").first()).toBeVisible();
  const initialMarks = await p.locator(".rah-search-hit mark").count();
  assert.ok(initialMarks > 0);
  await hit.click();
  await p.mouse.move(1200, 700);
  await expect(p.locator(".rah-search-hit mark")).toHaveCount(initialMarks);
  await p.locator(".rah-search-section-title").click();
  await expect(p.locator(".rah-search-hit mark")).toHaveCount(initialMarks);
  await p.mouse.wheel(0, 100);
  await expect(p.locator(".rah-search-hit mark")).toHaveCount(initialMarks);
  const separator = p.getByRole("separator", {
    name: "调整搜索结果宽度",
    exact: true,
  });
  await expect(separator).toBeVisible();
  for (const name of ["搜索当前对话", "频道详情与设置"])
    await expect(p.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(
    p
      .locator(".rah-conversation-head")
      .getByRole("button", { name: "关闭搜索预览", exact: true }),
  ).toHaveCount(0);
  const returnToResults = async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole("button", { name: "返回搜索结果", exact: true }).click();
    await p.setViewportSize({ width: 1440, height: 900 });
  };
  const results = p.locator(".rah-discovery");
  const before = (await results.boundingBox()).width;
  const box = await separator.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + 100);
  await p.mouse.down();
  await p.mouse.move(box.x - 70, box.y + 100, { steps: 8 });
  await p.mouse.up();
  assert.ok((await results.boundingBox()).width < before - 40);
  await expect(
    p
      .locator(".rah-conversation-head")
      .getByRole("button", { name: "关闭搜索预览", exact: true }),
  ).toHaveCount(0);
  await returnToResults();
  await expect(p.locator(".rah-search-channel-open")).toHaveCount(0);
  await hit.hover();
  await expect(hit.locator("mark")).not.toHaveCount(0);
  await hit.click();
  await p.setViewportSize({ width: 900, height: 900 });
  await expect
    .poll(async () => (await results.boundingBox()).width)
    .toBeLessThan(before);
  await expect(separator).toBeVisible();
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(results).toBeHidden();
  await p.getByRole("button", { name: "返回搜索结果", exact: true }).click();
  await expect(results).toBeVisible();
  await expect(p.locator(".rah-search-channel-open")).toHaveCount(0);
  await p.setViewportSize({ width: 1440, height: 900 });
  for (const name of ["Agent 与成员", "计算机", "任务", "聊天"]) {
    await hit.click();
    await p
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name, exact: true })
      .click();
    await p
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "搜索", exact: true })
      .click();
    await expect(
      p.getByRole("textbox", { name: "搜索频道、私信、消息", exact: true }),
    ).toHaveValue("");
    await expect(p.locator(".rah-search-hit")).toHaveCount(0);
    await expect(p.locator(".rah-search-channel-open")).toHaveCount(0);
    await p
      .getByRole("textbox", { name: "搜索频道、私信、消息", exact: true })
      .fill("History");
    await hit.waitFor();
  }
  await p.goto(f.origin + "/?room=" + f.roomId);
  await p.locator("label").filter({ hasText: "作为任务" }).click();
  const composer = p.getByRole("textbox", { name: "消息输入框", exact: true });
  await composer.fill("Preview invariant root");
  await composer.press("Enter");
  const root = p
    .locator(".channel .msg")
    .filter({ hasText: "Preview invariant root" })
    .first();
  await root.waitFor();
  await root.hover();
  await root
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  const reply = p.getByRole("textbox", {
    name: "Thread 回复输入框",
    exact: true,
  });
  await reply.fill("Preview invariant reply");
  await reply.press("Enter");
  await p
    .locator(".thread .msg")
    .filter({ hasText: "Preview invariant reply" })
    .first()
    .waitFor();
  await p.goto(f.origin + "/?room=" + f.roomId);
  const dm = p.locator(".rah-direct-room-row").first();
  await dm.click();
  await expect(dm).toHaveClass(/is-selected/);
  await expect(composer).toBeEnabled();
  const toggle = p.getByRole("checkbox", { name: "作为任务", exact: true });
  if ((await toggle.count()) && (await toggle.isChecked()))
    await p.locator("label").filter({ hasText: "作为任务" }).click();
  await composer.fill("Preview invariant direct");
  await composer.press("Enter");
  await p
    .locator(".channel .msg")
    .filter({ hasText: "Preview invariant direct" })
    .first()
    .waitFor();
  await p.goto(f.origin + "/?surface=search&q=Preview%20invariant");
  for (const text of [
    "Preview invariant direct",
    "Preview invariant reply",
    "Preview invariant root",
  ]) {
    await p
      .locator(".rah-search-hit")
      .filter({ hasText: text })
      .first()
      .click();
    await expect(separator).toBeVisible();
    await expect(results).toBeVisible();
    await expect(
      p.locator('.msg[data-focused="true"]').filter({ hasText: text }).first(),
    ).toBeVisible();
    await expect(
      p
        .locator(".rah-conversation-head")
        .getByRole("button", { name: "关闭搜索预览", exact: true }),
    ).toHaveCount(0);
  }
  await p
    .locator('.channel [data-testid="message-task-badge"]')
    .first()
    .click();
  await expect(p.locator(".rah-task-detail-properties")).toBeVisible();
  await p.reload();
  await expect(p.locator(".rah-task-detail-properties")).toBeVisible();
  assert.equal(new URL(p.url()).searchParams.get("target"), "task");
  await expect(results).toBeVisible();
  await expect(separator).toBeVisible();
  assert.equal(
    await p
      .locator(".thread")
      .evaluate((e) => getComputedStyle(e).borderLeftWidth),
    "2px",
  );
  await p.locator(".rah-search-hit").first().waitFor();
  await p.screenshot({ path: "/tmp/rah-search-layout-task-preview.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await expect(results).toBeHidden();
  await expect(
    p.locator(".thread").getByRole("button", { name: "返回聊天", exact: true }),
  ).toBeVisible();
  await p.screenshot({ path: "/tmp/rah-search-layout-task-mobile.png" });
  await p.locator(".thread .rah-thread-back").click();
  await expect(p.locator(".thread")).toHaveCount(0);
  await expect(p.locator(".rah-search-channel-open > .channel")).toBeVisible();
  await p.setViewportSize({ width: 1440, height: 900 });
  await returnToResults();
  await expect(p.locator(".rah-search-channel-open")).toHaveCount(0);
  await expect(p.locator(".channel")).toHaveCount(0);
  await expect(p.locator(".thread")).toHaveCount(0);
  for (const selector of [".rah-search-count", ".rah-search-section-title"])
    assert.deepEqual(
      await p
        .locator(selector)
        .first()
        .evaluate((e) => ({
          size: getComputedStyle(e).fontSize,
          weight: getComputedStyle(e).fontWeight,
          family: getComputedStyle(e).fontFamily,
        })),
      await p.locator(".rah-search-count").evaluate((e) => ({
        size: "12px",
        weight: "700",
        family: getComputedStyle(e).fontFamily,
      })),
    );
  await p.screenshot({ path: "/tmp/rah-search-layout-results.png" });
  await p
    .locator(".rah-search-hit")
    .filter({ hasText: "Preview invariant root" })
    .first()
    .click();
  await p
    .locator('.channel [data-testid="message-task-badge"]')
    .first()
    .click();
  await expect(p.locator(".rah-task-detail-properties")).toBeVisible();
  await p
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "任务", exact: true })
    .click();
  await expect(p.getByTestId("task-thread-modal")).toHaveCount(0);
  console.log(
    "search resizer, preview close/back, hover words and navigation reset passed",
  );
} finally {
  await b.close();
  await f.close();
}
