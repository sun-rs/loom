import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(10000);
  let ids = [];
  await p.route("**/v3/client/agents/list", async (route) => {
    const r = await route.fetch();
    const data = await r.json();
    ids = data.agents.map((a) => a.definition.participantId);
    await route.fulfill({ response: r });
  });
  await p.route("**/activity/thread-followers", async (route) =>
    route.fulfill({
      json: { agentParticipantIds: ids, canManage: true, following: false },
    }),
  );
  let removes = 0;
  await p.route("**/activity/thread-followers/remove", async (route) => {
    removes++;
    await route.fulfill({
      status: 500,
      json: { error: { message: "fixture remove failed" } },
    });
  });
  await p.goto(f.origin + "/?surface=settings&settingsSection=account");
  await p
    .getByRole("textbox", { name: "显示名称", exact: true })
    .fill("Updated Human");
  const savedProfile = p.waitForResponse((r) =>
    r.url().endsWith("/principals/update"),
  );
  await p.getByRole("button", { name: "保存资料", exact: true }).click();
  assert.equal((await savedProfile).status(), 200);
  await p.goto(f.origin + "/?roomId=" + f.roomId);
  await p.locator(".msg").first().waitFor();
  const roomComposer = p.getByRole("textbox", {
    name: "消息输入框",
    exact: true,
  });
  await roomComposer.fill("@");
  const agentBadge = p.locator(".rah-composer-mention-copy small").first();
  await agentBadge.waitFor();
  assert.equal(
    await agentBadge.evaluate((e) => getComputedStyle(e).fontWeight),
    "700",
  );
  await roomComposer.fill("");
  await p.locator(".msg").first().hover();
  await p
    .locator(".msg")
    .first()
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  await p.locator(".thread").waitFor();
  const input = p.getByRole("textbox", {
    name: "Thread 回复输入框",
    exact: true,
  });
  await input.fill("Follower UI fixture reply");
  await input.press("Enter");
  const humanAvatar = p
    .locator('.thread button[aria-label="查看 Updated Human 资料"]')
    .first();
  await humanAvatar.waitFor();
  assert.equal(
    await p.locator(".thread .msg-head b").first().innerText(),
    "Updated Human",
  );
  await humanAvatar.click();
  const humanInspector = p.getByRole("main", { name: "Human 详情侧栏" });
  await humanInspector.waitFor();
  assert.equal(await humanInspector.getByRole("tab").count(), 0);
  await humanInspector.getByRole("button", { name: /关闭/ }).click();
  const trigger = p.getByTestId("thread-followers-header-trigger");
  await trigger.waitFor();
  await trigger.click();
  const popup = p.getByRole("dialog", {
    name: "正在关注的 Agent",
    exact: true,
  });
  const row = popup.getByRole("button", {
    name: "查看 Alice 资料",
    exact: true,
  });
  await row.waitFor();
  const removeIcon = popup.locator(".rah-thread-follower-remove svg").first();
  for (const width of [900, 390, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    const contained = await removeIcon.evaluate((svg) => {
      const button = svg.parentElement.getBoundingClientRect();
      const icon = svg.getBoundingClientRect();
      const drawing = svg.querySelector("path, use").getBoundingClientRect();
      return [icon, drawing].every(
        (r) =>
          r.width > 0 &&
          r.height > 0 &&
          r.left >= button.left &&
          r.right <= button.right &&
          r.top >= button.top &&
          r.bottom <= button.bottom,
      );
    });
    assert.ok(contained, "remove glyph stays inside its button after resize");
  }

  await row.hover();
  assert.equal(
    await row.evaluate((e) => getComputedStyle(e).borderRadius),
    "4px",
  );
  const inset = await row.evaluate(
    (e) =>
      e.getBoundingClientRect().top -
      e.parentElement.getBoundingClientRect().top,
  );
  assert.ok(inset >= 4);
  await p.locator(".thread .rah-thread-close").waitFor({ state: "visible" });
  assert.equal(await p.locator(".thread .rah-thread-back").isVisible(), false);
  const before = p.url();
  await row.click({ position: { x: 8, y: 10 } });
  await p.locator(".rah-agent-peek").waitFor();
  const activityTab = p
    .locator(".rah-agent-peek")
    .getByRole("tab", { name: "动态", exact: true });
  await expect(activityTab).toHaveAttribute("aria-selected", "true");
  await p
    .locator(".rah-agent-peek")
    .getByRole("tab", { name: "资料", exact: true })
    .click();
  await trigger.click();
  await row.click();
  await expect(activityTab).toHaveAttribute("aria-selected", "true");
  const moreIcon = p
    .locator(".rah-agent-peek .rah-agent-overflow-actions svg")
    .first();
  assert.ok(
    (await moreIcon.locator("use").getAttribute("href")).endsWith(
      "#raft-icon-ellipsis-vertical",
    ),
  );
  assert.equal((await moreIcon.boundingBox()).width, 14);
  const threadBox = await p.locator(".thread").boundingBox();
  const profileBox = await p.locator(".rah-agent-peek").boundingBox();
  assert.ok(
    threadBox &&
      profileBox &&
      threadBox.x + threadBox.width <= profileBox.x + 1,
    "thread and inspector must not overlap",
  );
  assert.equal(await p.locator(".thread").isVisible(), true);
  assert.equal(p.url(), before);
  assert.equal(removes, 0);
  await p.setViewportSize({ width: 1200, height: 900 });
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-product-shell").dataset
        .conversationLayout === "split",
  );
  assert.equal(await p.locator(".thread").isVisible(), true);
  assert.equal(
    await p
      .locator(".rah-product-shell > .channel:not(.rah-agent-peek)")
      .isVisible(),
    false,
  );

  await p.locator(".thread .rah-thread-close").waitFor({ state: "visible" });
  assert.equal(await p.locator(".thread .rah-thread-back").isVisible(), false);
  await input.fill("Preserved responsive draft");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-agent-peek")?.getBoundingClientRect()
        .width === 390,
  );
  assert.equal(await p.locator(".thread").isVisible(), false);
  assert.equal((await p.locator(".rah-agent-peek").boundingBox()).width, 390);
  await p.locator(".rah-agent-peek .rah-agent-mobile-back").click();
  await p.locator(".thread").waitFor({ state: "visible" });
  assert.equal(await input.inputValue(), "Preserved responsive draft");
  assert.equal(await p.locator(".thread .rah-thread-close").isVisible(), false);
  assert.equal(
    await p
      .locator(".rah-product-shell > .channel:not(.rah-agent-peek)")
      .isVisible(),
    false,
  );
  await p.locator(".thread .rah-thread-back").click();
  await roomComposer.waitFor({ state: "visible" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.locator(".msg").first().hover();
  await p
    .locator(".msg")
    .first()
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  await trigger.click();
  await row.click();
  await p.setViewportSize({ width: 1200, height: 900 });
  await p.getByRole("button", { name: "关闭 Agent 侧栏", exact: true }).click();
  assert.equal(
    await p
      .locator(".rah-product-shell > .channel:not(.rah-agent-peek)")
      .isVisible(),
    true,
  );
  await p.setViewportSize({ width: 1440, height: 900 });
  await trigger.click();
  const rowBox = await row.boundingBox();
  await row.click({ position: { x: rowBox.width - 6, y: rowBox.height / 2 } });
  await p.locator(".rah-agent-peek").waitFor();
  await p.screenshot({ path: "/tmp/rah-follower-profile-open.png" });
  await p.getByRole("button", { name: "关闭 Agent 侧栏", exact: true }).click();
  for (const key of ["Enter", "Space"]) {
    await trigger.click();
    await row.focus();
    await p.keyboard.press(key);
    await p.locator(".rah-agent-peek").waitFor();
    assert.equal(p.url(), before);
    await p
      .getByRole("button", { name: "关闭 Agent 侧栏", exact: true })
      .click();
  }
  await trigger.click();
  await popup
    .getByRole("button", { name: "查看 Kimi 资料", exact: true })
    .click();
  await p.setViewportSize({ width: 1200, height: 900 });
  await p.locator(".thread .rah-thread-close").click();
  assert.equal(await p.locator(".rah-agent-peek").isVisible(), true);
  assert.equal(
    await p
      .locator(".rah-product-shell > .channel:not(.rah-agent-peek)")
      .isVisible(),
    true,
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-agent-peek")?.getBoundingClientRect()
        .width === 390,
  );
  assert.equal(
    await p
      .locator(".rah-product-shell > .channel:not(.rah-agent-peek)")
      .isVisible(),
    false,
  );
  assert.equal((await p.locator(".rah-agent-peek").boundingBox()).width, 390);
  await p.locator(".rah-agent-peek .rah-agent-mobile-back").click();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.locator(".msg").first().hover();
  await p
    .locator(".msg")
    .first()
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  await trigger.click();
  await popup.getByRole("button", { name: "移除 Alice", exact: true }).click();
  assert.equal(
    await p.getByRole("dialog", { name: "移除关注", exact: true }).count(),
    0,
  );
  await popup.getByRole("alert").waitFor();
  assert.equal(removes, 1);
  assert.equal(await p.locator(".rah-agent-peek").count(), 0);
  await p.screenshot({ path: "/tmp/rah-follower-row.png" });
  await p.keyboard.press("Escape");
  await p.getByTestId("thread-overflow-trigger").click();
  await p
    .getByRole("menuitem", { name: "在消息列中搜索", exact: true })
    .click();
  const search = p.getByRole("textbox", {
    name: "在消息列中搜索",
    exact: true,
  });
  assert.equal(
    await search.evaluate((e) => getComputedStyle(e).borderTopWidth),
    "2px",
  );
  await search.click();
  assert.deepEqual(
    await search.evaluate((e) => {
      const s = getComputedStyle(e);
      return {
        outline: s.outlineStyle,
        shadow: s.boxShadow.endsWith("rgb(20, 17, 17) 2px 2px 0px 0px"),
        border: s.borderTopWidth,
      };
    }),
    { outline: "none", shadow: true, border: "2px" },
    "focused search uses an offset hard shadow, not a surrounding outline",
  );
  await search.press("Tab");
  await p.keyboard.press("Shift+Tab");
  assert.equal(
    await search.evaluate(
      (e) =>
        document.activeElement === e &&
        getComputedStyle(e).outlineStyle === "none",
    ),
    true,
    "keyboard focus uses the same visible hard shadow",
  );
  await search.fill("fixture");
  await p.waitForFunction(
    () => document.querySelectorAll(".thread mark").length >= 2,
  );
  const next = p.getByRole("button", { name: "下一个搜索结果", exact: true });
  assert.equal((await next.boundingBox()).height, 28);
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-thread-search > span")?.textContent ===
      "1/2",
  );
  await next.click();
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-thread-search > span")?.textContent ===
      "2/2",
  );
  const focus = p.locator('.thread .msg[data-focused="true"]').last();
  const style = await focus.evaluate((e) => ({
    border: getComputedStyle(e).borderTopWidth,
    shadow: getComputedStyle(e).boxShadow,
    bg: getComputedStyle(e).backgroundColor,
  }));
  assert.equal(style.border, "2px");
  assert.notEqual(style.shadow, "none");
  assert.ok(!style.bg.includes("255, 244"));
  await p.locator(".thread").hover();
  await p.mouse.wheel(0, 150);
  await expect(focus).toHaveAttribute("data-focused", "true");
  assert.ok((await p.locator(".thread mark").count()) > 0);
  await input.click();
  await expect(p.locator('.thread .msg[data-focused="true"]')).toHaveCount(0);
  await expect(p.locator(".thread mark")).toHaveCount(0);
  await expect(input).toBeFocused();
  assert.equal(await search.inputValue(), "fixture");
  await next.click();
  await expect(p.locator('.thread .msg[data-focused="true"]')).toHaveCount(1);
  assert.ok((await p.locator(".thread mark").count()) > 0);
  await search.fill("Follower UI fixture reply");
  await expect(p.locator(".rah-thread-search > span")).toHaveText("1/1");
  await p.setViewportSize({ width: 390, height: 844 });
  await input.click();
  await expect(p.locator(".thread mark")).toHaveCount(0);
  await next.click();
  await expect(p.locator('.thread .msg[data-focused="true"]')).toHaveCount(1);
  assert.ok((await p.locator(".thread mark").count()) > 0);
  await p.screenshot({ path: "/tmp/rah-highlight-mobile.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.screenshot({ path: "/tmp/rah-thread-search-parity.png" });
  await p.getByRole("button", { name: "关闭消息列搜索", exact: true }).click();
  await p.goto(f.origin + "/?roomId=" + f.roomId);
  await p.locator(".rah-direct-room-row").first().click();
  await p.locator(".rah-direct-header-avatar").click();
  await p.locator(".rah-agent-peek").waitFor();
  await expect(activityTab).toHaveAttribute("aria-selected", "true");
  await p
    .locator(".rah-agent-peek")
    .getByRole("tab", { name: "资料", exact: true })
    .click();
  await p.locator(".rah-direct-header-avatar").click();
  await expect(activityTab).toHaveAttribute("aria-selected", "true");
  const directRoom = p.locator(
    ".rah-product-shell > .channel:not(.rah-agent-peek)",
  );
  assert.equal(await directRoom.isVisible(), true);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-agent-peek")?.getBoundingClientRect()
        .width === 390,
  );
  await directRoom.waitFor({ state: "hidden" });
  assert.equal((await p.locator(".rah-agent-peek").boundingBox()).width, 390);
  await p.locator(".rah-agent-peek .rah-agent-mobile-back").click();
  await directRoom.waitFor({ state: "visible" });
  console.log(
    "Follower pointer/keyboard opens shared inspector; remove stays independent",
  );
} finally {
  await browser.close();
  await f.close();
}
