import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const engine =
  process.env.RAH_TOUCH_ENGINE === "webkit" ? "webkit" : "chromium";
const f = await startShellFixture();
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const post = async (path, data) => {
    const r = await page.request.post(`${f.origin}/v3/client/${path}`, {
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  for (let i = 0; i < 24; i++) {
    const sync = await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "touch-test",
    });
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: sync.latestRoomSeq,
      kind: "channel",
      name: `Touch fixture ${i}`,
      slug: `touch-fixture-${i}`,
      visibility: "public",
      idempotencyKey: `touch-room-${i}`,
    });
  }
  await page.goto(f.origin);
  const sidebar = page.locator(".rah-room-sidebar");
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).x))
    .toBe(0);
  const body = sidebar.locator(".sidebar-body");
  const row = sidebar.locator("[data-sidebar-key]").first();
  await expect(row).toBeVisible();
  const label = row.locator("button").first();
  const style = await label.evaluate((el) => ({
    select: getComputedStyle(el).userSelect,
    webkitSelect: getComputedStyle(el).webkitUserSelect,
  }));
  assert.equal(
    style.select === "none" || style.webkitSelect === "none",
    true,
    "chat row disables native text selection",
  );
  assert.equal(
    await label.evaluate((el) => getComputedStyle(el).webkitTapHighlightColor),
    "rgba(0, 0, 0, 0)",
    "native tap flash must not resemble text selection",
  );
  const patches = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/sidebar/patch")) patches.push(r.postData());
  });
  const cdp =
    engine === "chromium" ? await page.context().newCDPSession(page) : null;
  // Chromium dispatches native touch input (including compositor scrolling).
  // WebKit's automation has no touch-drag API: DOM touch events cover only the
  // long-press lifecycle; they do not certify physical iOS scrolling/callouts.
  let target;
  let moved = false;
  async function touch(type, x, y) {
    if (cdp) {
      await cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints:
          type === "touchEnd" || type === "touchCancel"
            ? []
            : [{ x, y, id: 1 }],
      });
    } else {
      if (type === "touchStart") {
        moved = false;
        target = await page.evaluateHandle(
          ({ x, y }) => document.elementFromPoint(x, y),
          { x, y },
        );
      }
      if (type === "touchMove") moved = true;
      await target.evaluate(
        (el, { type, x, y, moved }) => {
          const t = {
            identifier: 1,
            target: el,
            clientX: x,
            clientY: y,
            pageX: x,
            pageY: y,
            screenX: x,
            screenY: y,
          };
          const event = new Event(type.toLowerCase(), {
            bubbles: true,
            cancelable: true,
          });
          const touches =
            type === "touchEnd" || type === "touchCancel" ? [] : [t];
          Object.defineProperties(event, {
            touches: { value: touches },
            targetTouches: { value: touches },
            changedTouches: { value: [t] },
          });
          el.dispatchEvent(event);
          if (type === "touchEnd" && !moved)
            el.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                detail: 1,
              }),
            );
        },
        { type, x, y, moved },
      );
    }
  }
  const point = async (locator) => {
    const b = await locator.boundingBox();
    assert.ok(b);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  let pos = await point(row);
  if (cdp) {
    await touch("touchStart", pos.x, pos.y);
    await touch("touchMove", pos.x + 9, pos.y);
    await page.waitForTimeout(80);
    await expect(sidebar.locator(".is-dragging")).toHaveCount(0);
    await expect(page.locator(".rah-sidebar-drag-preview")).toHaveCount(0);
    await touch("touchCancel", pos.x + 9, pos.y);
  }
  const location = page.url();
  await touch("touchStart", pos.x, pos.y);
  await page.waitForTimeout(600);
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();
  const anchor = await menu.boundingBox();
  const lockedScroll = await body.evaluate((el) => el.scrollTop);
  for (let i = 1; i <= 5; i++) {
    await touch("touchMove", pos.x, pos.y - i * 16);
    await page.waitForTimeout(30);
  }
  await expect(menu).toBeVisible();
  assert.equal(
    await body.evaluate((el) => el.scrollTop),
    lockedScroll,
    "open menu freezes background touch scrolling",
  );
  const afterMove = await menu.boundingBox();
  assert.ok(
    Math.abs(afterMove.y - anchor.y) < 1,
    "open menu keeps its initial screen anchor",
  );
  assert.notEqual(
    await label.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(254, 125, 168)",
    "mobile home never paints its hidden conversation pink",
  );
  await touch("touchEnd", pos.x, pos.y - 80);
  await expect(menu).toBeVisible();
  await page.waitForTimeout(500);
  await touch("touchStart", 10, 730);
  for (let i = 1; i <= 4; i++) {
    await touch("touchMove", 10, 730 - i * 20);
    await page.waitForTimeout(30);
  }
  await touch("touchEnd", 10, 650);
  await expect(menu).toBeVisible();
  assert.equal(
    await body.evaluate((el) => el.scrollTop),
    lockedScroll,
    "later background swipe stays locked too",
  );
  const afterSwipe = await menu.boundingBox();
  assert.ok(
    Math.abs(afterSwipe.y - anchor.y) < 1,
    "later swipe cannot reposition the menu",
  );
  await expect(sidebar).toHaveClass(/is-open/);
  assert.equal(
    page.url(),
    location,
    "long press must not open the conversation on release",
  );
  assert.equal(await page.evaluate(() => getSelection()?.toString()), "");
  await expect(sidebar.locator(".channel-row.is-selected")).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "移动到分区", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `/tmp/rah-sidebar-touch-${engine}.png` });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  const header = sidebar.locator(
    '[data-sidebar-group="channels"] .rah-sidebar-disclosure',
  );
  pos = await point(header);
  await touch("touchStart", pos.x, pos.y);
  await page.waitForTimeout(600);
  await expect(
    page.getByRole("menuitem", { name: "新建分区…", exact: true }),
  ).toBeVisible();
  await touch("touchEnd", pos.x, pos.y);
  await expect(header).toHaveAttribute("aria-expanded", "true");
  // Base UI preserves Raft's 500ms opening grace against release dismissal.
  await page.waitForTimeout(500);
  // A real outside tap closes the menu without changing the underlying route.
  await page.touchscreen.tap(200, 60);

  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(sidebar).toHaveClass(/is-open/);
  // The transparent touch backdrop must not intercept menu actions.
  pos = await point(header);
  await touch("touchStart", pos.x, pos.y);
  await page.waitForTimeout(600);
  await touch("touchEnd", pos.x, pos.y);
  await page.getByRole("menuitem", { name: "新建分区…", exact: true }).tap();
  const sectionDialog = page.getByRole("dialog", {
    name: "新建分区",
    exact: true,
  });
  await expect(sectionDialog).toBeVisible();
  await sectionDialog.getByRole("button", { name: "取消", exact: true }).tap();
  await expect(sectionDialog).toBeHidden();
  // Movement and cancellation must release the long-press timer.
  for (const cancel of [false, true]) {
    pos = await point(row);
    await touch("touchStart", pos.x, pos.y);
    if (cancel) await touch("touchCancel", pos.x, pos.y);
    else {
      await touch("touchMove", pos.x, pos.y - 25);
      await touch("touchEnd", pos.x, pos.y - 25);
    }
    await page.waitForTimeout(600);
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  if (cdp) {
    await body.evaluate((el) => {
      el.scrollTop = 0;
    });
    // Scroll from both a conversation and the section header; neither owns touch drag.
    for (const start of [
      row,
      sidebar.locator(
        '[data-sidebar-group="channels"] .rah-sidebar-disclosure',
      ),
    ]) {
      await body.evaluate((el) => {
        el.scrollTop = 0;
      });
      const a = await point(start);
      await touch("touchStart", a.x, a.y);
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", a.x, a.y - i * 18);
        await page.waitForTimeout(20);
      }
      await touch("touchEnd", a.x, a.y - 144);
      await expect
        .poll(() => body.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(30);
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(page.locator(".rah-sidebar-drag-preview")).toHaveCount(0);
    }
    await page.screenshot({ path: "/tmp/rah-sidebar-touch-scrolled.png" });
  }
  assert.deepEqual(patches, [], "touch gestures never persist a reorder");
  await body.evaluate((el) => {
    el.scrollTop = 0;
  });
  await label.tap();
  await expect(sidebar).not.toHaveClass(/is-open/);
  console.log(
    `${engine}: long press, no selection, release/cancel, tap passed; ${cdp ? "native row/header scrolling and no touch reorder passed" : "iOS native scroll/callout remains device-only"}`,
  );
} finally {
  await browser.close();
  await f.close();
}
