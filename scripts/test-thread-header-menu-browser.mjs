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
    ids = data.agents.map((a) => a.definition.participantId);
    await route.fulfill({ response: r });
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
  await p.route("**/activity/thread-followers/remove", async (route) => {
    removes++;
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
        ?.textContent.trim() === "2",
  );
  const avatarGap = await trigger
    .locator(".rah-agent-avatar")
    .evaluateAll((avatars) => {
      const first = avatars[0].getBoundingClientRect();
      const second = avatars[1].getBoundingClientRect();
      return second.left - first.right;
    });
  assert.equal(
    avatarGap,
    3,
    "follower avatars have a visible gap rather than overlapping",
  );
  await trigger.screenshot({ path: "/tmp/rah-follower-avatar-gap.png" });
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
    "2",
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
    ["在消息列中搜索", "在新标签页中打开", "在频道中查看", "关注消息列"],
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
  const url = p.url();
  const popupPromise = p.waitForEvent("popup");
  await menu
    .getByRole("menuitem", { name: "在新标签页中打开", exact: true })
    .click();
  const tab = await popupPromise;
  await tab.waitForURL((u) => u.searchParams.has("thread"));
  assert.equal(
    new URL(tab.url()).searchParams.get("thread"),
    new URL(url).searchParams.get("thread"),
  );
  assert.equal(p.url(), url);
  await tab.close();
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
        ?.textContent.trim() === "2",
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
    "Thread menu, new tab, hidden zero-count control and follower polling passed",
  );
} finally {
  await browser.close();
  await f.close();
}
