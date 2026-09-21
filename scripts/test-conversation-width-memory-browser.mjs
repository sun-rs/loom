import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const channel = page.locator(
    ".rah-product-shell > .channel:not(.rah-agent-peek)",
  );
  const profile = page.locator(".rah-agent-peek");
  const width = async (locator) =>
    Math.round((await locator.boundingBox()).width);
  const go = async (surface) => {
    await page.goto(
      fixture.origin +
        "/?" +
        new URLSearchParams({
          surface,
          room: fixture.roomId,
          ...(surface === "room" ? {} : { previewRoom: fixture.roomId }),
        }),
    );
    await expect(page.locator(".rah-conversation-head")).toBeVisible();
  };
  const grip = (name) => page.getByRole("separator", { name, exact: true });
  const drag = async (locator, dx) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + 150, {
      steps: 12,
    });
    await page.mouse.up();
  };
  await go("search");
  const searchGrip = grip("调整搜索结果宽度");
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "560");
  await drag(searchGrip, -80);
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "480");
  await go("activity");
  const activityGrip = grip("调整动态列表宽度");
  await expect(activityGrip).toHaveAttribute("aria-valuenow", "480");
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(activityGrip).toHaveAttribute("aria-valuenow", "320");
  await drag(activityGrip, 80);
  await expect(activityGrip).toHaveAttribute("aria-valuenow", "400");
  await go("search");
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "400");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "480");
  await searchGrip.press("Enter");
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "560");
  await channel
    .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
    .first()
    .click();
  await expect(profile).toBeVisible();
  // Extra pane selects the compact preference, independently from profile width.
  await expect(searchGrip).toHaveAttribute("aria-valuenow", "400");
  await expect.poll(() => width(profile)).toBe(380);
  const profileGrip = grip("调整 Agent 资料面板宽度");
  await drag(profileGrip, -40);
  await expect.poll(() => width(profile)).toBe(420);
  const saved = await page.evaluate(() => ({
    profile: localStorage.getItem("rah:profile-panel-width"),
    thread: localStorage.getItem("rah:thread-panel-width"),
  }));
  assert.deepEqual(saved, { profile: "420", thread: null });
  await searchGrip.press("Enter"); // compact reset to 320
  for (const [viewport, expected, visible] of [
    [1064, 360, true],
    [1004, 300, true],
    [1003, 619, false],
  ]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await expect.poll(() => width(profile)).toBe(expected);
    if (visible) await expect(channel).toBeVisible();
    else await expect(channel).toBeHidden();
  }
  // Drag starts at the actual 360px, not the stored 420px.
  await page.setViewportSize({ width: 1064, height: 900 });
  await profileGrip.click();
  assert.equal(
    await page.evaluate(() => localStorage.getItem("rah:profile-panel-width")),
    "420",
    "a click without dragging must not save the temporary compressed width",
  );
  await drag(profileGrip, 20);
  await expect.poll(() => width(profile)).toBe(340);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("rah:profile-panel-width")),
    )
    .toBe("340");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(profile).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => width(profile)).toBe(340);
  await profileGrip.press("Enter");
  await expect.poll(() => width(profile)).toBe(380);
  await page.screenshot({
    path: `/tmp/conversation-width-${process.env.RAH_BROWSER || "chromium"}.png`,
  });
  // Reload at mobile size must retain the desktop thread preference for expansion.
  await page.evaluate(() =>
    localStorage.setItem("rah:thread-panel-width", "600"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await go("room");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() =>
      page
        .locator("[data-conversation-shell]")
        .evaluate((el) => el.style.getPropertyValue("--thread-w")),
    )
    .toBe("600px");
  await expect(grip("调整聊天边栏宽度")).toHaveAttribute(
    "aria-valuenow",
    "240",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS shared wide/compact memory, profile geometry and independence, pointer clamp, reset, mobile reload restoration",
  );
} finally {
  await browser.close();
  await fixture.close();
}
