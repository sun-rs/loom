import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(10000);
  let ids = [];
  let empty = false;
  let pauseFollowers;
  let followerStarted;
  await p.route("**/v3/client/agents/list", async (route) => {
    const r = await route.fetch();
    const data = await r.json();
    const template = data.agents[0];
    for (let i = 0; i < 3; i++) {
      data.agents.push({
        ...template,
        handle: `fixture-follower-${i}`,
        definition: {
          ...template.definition,
          agentId: `fixture-agent-${i}`,
          participantId: `fixture-principal-${i}`,
        },
        currentRevision: {
          ...template.currentRevision,
          agentId: `fixture-agent-${i}`,
          displayName: `Fixture follower ${i}`,
        },
      });
    }
    ids = data.agents.map((a) => a.definition.participantId);
    await route.fulfill({ response: r, json: data });
  });
  await p.route("**/activity/thread-followers", async (route) => {
    followerStarted?.();
    if (pauseFollowers) await pauseFollowers;
    return route.fulfill({
      json: {
        agentParticipantIds: empty ? [] : ids,
        canManage: true,
        following: false,
      },
    });
  });
  let removes = 0;
  let successfulRemove = false;
  await p.route("**/activity/thread-followers/remove", async (route) => {
    removes++;
    if (successfulRemove)
      return route.fulfill({
        json: {
          removed: true,
          undoToken: "fixture-undo",
          undoExpiresAt: new Date(Date.now() + 30000).toISOString(),
        },
      });
    await route.fulfill({
      status: 500,
      json: { error: { message: "fixture remove failed" } },
    });
  });
  await p.goto(f.origin + "/?roomId=" + f.roomId);
  await p.locator(".msg").first().waitFor();
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
  const trigger = p.getByTestId("thread-followers-header-trigger");
  await trigger.waitFor();
  await p.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="thread-followers-header-trigger"]')
        ?.textContent.trim() === "5",
  );
  assert.equal(await trigger.locator(".rah-agent-avatar").count(), 3);
  const avatarGap = await trigger
    .locator(".rah-agent-avatar")
    .evaluateAll((avatars) => {
      const first = avatars[0].getBoundingClientRect();
      const second = avatars[1].getBoundingClientRect();
      return second.left - first.right;
    });
  assert.equal(
    avatarGap,
    -4,
    "follower avatars overlap by the Raft 4px spacing",
  );
  await trigger.screenshot({ path: "/tmp/rah-follower-avatar-gap.png" });
  await trigger.click();
  const popup = p.locator(".rah-thread-followers-popover");
  await popup.waitFor();
  assert.deepEqual(
    await popup.locator("strong").evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.padding, s.fontSize, s.lineHeight];
    }),
    ["8px 12px", "14px", "20px"],
  );
  assert.equal(await popup.locator(".rah-thread-followers-list").count(), 1);
  assert.deepEqual(
    await popup
      .locator(".rah-thread-follower-row")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el),
          name = getComputedStyle(el.querySelector("b"));
        return [s.padding, s.gap, name.fontSize, name.lineHeight];
      }),
    ["6px 4px", "8px", "14px", "20px"],
  );
  assert.equal(
    await popup
      .locator(".rah-thread-follower-row")
      .nth(1)
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    "0px",
  );
  assert.equal(
    await popup
      .locator(".rah-thread-follower-row .rah-agent-avatar")
      .first()
      .evaluate((el) => el.getBoundingClientRect().width),
    28,
  );

  // A positioned rich-message layer must stay inside the message surface.
  await p
    .locator(".thread .msg")
    .first()
    .evaluate((el) => {
      el.style.position = "relative";
      el.style.zIndex = "80";
    });
  assert.equal(
    await popup.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + 40, r.y + 75));
    }),
    true,
    "message content cannot paint or receive pointer input above the follower popup",
  );
  await p.keyboard.press("Escape");
  await p
    .locator(".thread .msg")
    .first()
    .evaluate((el) => {
      el.style.position = "";
      el.style.zIndex = "";
    });
  successfulRemove = true;
  await p.route("**/activity/thread-followers/restore", (route) =>
    route.fulfill({ json: { restored: true } }),
  );
  await trigger.click();
  await p.locator(".rah-thread-follower-remove").first().click();
  assert.equal(
    await p.getByRole("dialog", { name: "移除关注", exact: true }).count(),
    0,
  );
  const toast = p.locator(".rah-thread-follower-undo");
  await toast.waitFor();
  assert.equal(
    await toast.evaluate((el) => {
      const sample = document.createElement("span");
      sample.style.background = "var(--green)";
      el.append(sample);
      const same =
        getComputedStyle(el).backgroundColor ===
        getComputedStyle(sample).backgroundColor;
      sample.remove();
      return same;
    }),
    true,
    "successful removal uses the success green",
  );
  assert.match(await toast.innerText(), /移出此消息列的关注者/);
  const geometry = await toast.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const button = el.querySelector("button").getBoundingClientRect();
    const label = el.querySelector(
      "span:not(.rah-thread-follower-success-icon)",
    );
    const range = document.createRange();
    range.selectNodeContents(label);
    return {
      gap: button.left - range.getBoundingClientRect().right,
      width: box.width,
    };
  });
  assert.ok(
    geometry.gap <= 16,
    "undo stays adjacent to text, without stretched blank space",
  );
  const placement = await toast.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      center: Math.round(box.x + box.width / 2),
      bottom: innerHeight - box.bottom,
      portal: el.parentElement.parentElement === document.body,
    };
  });
  assert.deepEqual(
    placement,
    { center: 720, bottom: 16, portal: true },
    "follower toast belongs to the viewport, not the right conversation pane",
  );
  await p.screenshot({ path: "/tmp/follower-success-toast.png" });
  const undo = toast.getByRole("button", { name: "撤销", exact: true });
  await undo.hover();
  await p.waitForTimeout(180);
  assert.equal(
    await undo.evaluate((el) => getComputedStyle(el).transform),
    "matrix(1, 0, 0, 1, 0, -1)",
  );
  assert.match(
    await undo.evaluate((el) => getComputedStyle(el).boxShadow),
    /2px 2px 0px/,
  );
  await undo.click();
  await toast.getByText(/已恢复 .* 的关注。/).waitFor();
  const close = toast.getByRole("button", { name: "关闭提示", exact: true });
  await close.hover();
  await p.waitForTimeout(180);
  assert.equal(
    await close.evaluate((el) => getComputedStyle(el).transform),
    "matrix(1, 0, 0, 1, 0, -1)",
  );
  assert.match(
    await close.evaluate((el) => getComputedStyle(el).boxShadow),
    /2px 2px 0px/,
  );
  await p.screenshot({ path: "/tmp/follower-restored-toast.png" });
  await close.click();
  await toast.waitFor({ state: "hidden" });
  await p.keyboard.press("Escape");
  await trigger.click();
  await p.locator(".rah-thread-follower-remove").first().click();
  assert.equal(
    await p.getByRole("dialog", { name: "移除关注", exact: true }).count(),
    0,
  );
  await toast.waitFor();
  await toast.hover();
  await p.waitForTimeout(5500);
  assert.equal(
    await toast.count(),
    1,
    "hover pauses the five-second display timer",
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await toast.hover();
  const narrow = await toast.boundingBox();
  assert.ok(narrow.x >= 16 && narrow.x + narrow.width <= 374);
  assert.ok(Math.abs(narrow.x + narrow.width / 2 - 195) < 1);
  await p.screenshot({ path: "/tmp/follower-success-toast-390.png" });
  await p.mouse.move(0, 0);
  await toast.waitFor({ state: "hidden", timeout: 6000 });
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(300); // Let the responsive layout transition settle.
  successfulRemove = false;
  const stableBox = await trigger.boundingBox();
  let release;
  pauseFollowers = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    followerStarted = resolve;
  });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await started;
  assert.equal(
    (await trigger.innerText()).trim(),
    "5",
    "background refresh retains count",
  );
  assert.deepEqual(
    await trigger.boundingBox(),
    stableBox,
    "background refresh does not move the control",
  );
  release();
  pauseFollowers = undefined;
  followerStarted = undefined;
  const menuTrigger = p.getByTestId("thread-overflow-trigger");
  await menuTrigger.click();
  const menu = p.getByRole("menu");
  assert.deepEqual(
    (await menu.getByRole("menuitem").allTextContents()).map((s) => s.trim()),
    ["在消息列中搜索", "在频道中查看", "关注消息列"],
  );
  assert.deepEqual(
    await menu
      .getByRole("menuitem")
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return [
          s.fontSize,
          s.fontWeight,
          getComputedStyle(el.querySelector("svg")).width,
        ];
      }),
    ["14px", "500", "14px"],
  );
  assert.ok(
    (await menuTrigger.locator("use").getAttribute("href")).endsWith(
      "#raft-icon-ellipsis-vertical",
    ),
  );
  assert.equal(
    await menu
      .getByRole("menuitem", { name: "在新标签页中打开", exact: true })
      .count(),
    0,
  );
  empty = true;
  const emptyLoaded = p.waitForResponse("**/activity/thread-followers");
  await p.reload();
  await emptyLoaded;
  await p.locator(".thread").waitFor();
  await p.waitForFunction(
    () =>
      !document.querySelector(
        '[data-testid="thread-followers-header-trigger"]',
      ),
  );
  pauseFollowers = new Promise((resolve) => {
    release = resolve;
  });
  const emptyRefresh = new Promise((resolve) => {
    followerStarted = resolve;
  });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await emptyRefresh;
  assert.equal(
    await trigger.count(),
    0,
    "empty count stays hidden during background refresh",
  );
  release();
  pauseFollowers = undefined;
  followerStarted = undefined;
  await p.setViewportSize({ width: 900, height: 900 });
  await p
    .getByRole("button", { name: "关闭消息列", exact: true })
    .waitFor({ state: "hidden" });
  await p.locator(".thread .rah-thread-back").waitFor({ state: "visible" });
  const backGeometry = await p
    .locator(".thread .rah-thread-back")
    .evaluate((e) => {
      const back = e.getBoundingClientRect(),
        head = e.parentElement.getBoundingClientRect(),
        title = e.parentElement
          .querySelector(".rah-thread-title")
          .getBoundingClientRect();
      return { left: back.left - head.left, gap: title.left - back.right };
    });
  assert.deepEqual(backGeometry, { left: 20, gap: 12 });
  empty = false;
  await p.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="thread-followers-header-trigger"]')
        ?.textContent.trim() === "5",
    {},
    { timeout: 12000 },
  );
  await menuTrigger.click();
  await p.screenshot({ path: "/tmp/rah-thread-menu.png" });
  await p.getByRole("menuitem", { name: "在频道中查看", exact: true }).click();
  const focused = p.locator('.channel .msg[data-focused="true"]').first();
  await focused.waitFor();
  assert.equal(
    await focused.evaluate((e) => getComputedStyle(e).outlineStyle),
    "none",
  );
  assert.notEqual(
    await focused.evaluate((e) => getComputedStyle(e).boxShadow),
    "none",
  );
  assert.equal(
    await focused.evaluate((e) => {
      const swatch = document.createElement("span");
      swatch.style.background = "color-mix(in srgb, var(--cyan) 25%, white)";
      e.append(swatch);
      const matches =
        getComputedStyle(e).backgroundColor ===
        getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      return matches;
    }),
    true,
  );
  assert.equal(
    await focused.evaluate((e) => getComputedStyle(e).borderTopWidth),
    "2px",
  );
  await p.screenshot({ path: "/tmp/rah-message-focus.png" });
  assert.equal(
    await p.getByText("已定位原消息及前后文", { exact: true }).count(),
    0,
  );
  await p.getByRole("button", { name: "回到底部", exact: true }).click();
  await p.waitForFunction(
    () => !document.querySelector('.channel .msg[data-focused="true"]'),
  );
  console.log(
    "Thread menu without new-tab action, hidden zero-count control and follower polling passed",
  );
} finally {
  await browser.close();
  await f.close();
}
