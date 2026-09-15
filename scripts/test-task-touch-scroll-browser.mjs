import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Isolated dense task projection; no real Room state or paid provider is changed.
  const dense = (seed) =>
    Array.from({ length: 35 }, (_, i) => ({
      ...seed,
      taskId: `scroll-task-${i}`,
      taskNumber: i + 1,
      title: `Touch scroll fixture task ${i + 1}`,
      state: "todo",
      workflowStatus: "todo",
      dependencyTaskIds: [],
    }));
  await page.route("**/v3/client/tasks/list", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        tasks: data.tasks.length
          ? dense(
              data.tasks.find((task) => task.state === "todo") ?? data.tasks[0],
            )
          : [],
      },
    });
  });
  let taskRoomId;
  await page.route("**/v3/client/tasks/global", async (route) => {
    const response = await route.fetch(),
      data = await response.json(),
      seed = data.tasks.find((item) => item.task.state === "todo");
    assert.ok(seed);
    taskRoomId = seed.task.roomId;
    await route.fulfill({
      response,
      json: {
        ...data,
        total: 35,
        tasks: dense(seed.task).map((task) => ({ ...seed, task })),
      },
    });
  });
  const changes = [];
  page.on("request", (request) => {
    if (
      /\/tasks\/(?:workflow|set-status|claim|close|complete|assign)$/.test(
        new URL(request.url()).pathname,
      )
    )
      changes.push(request.url());
  });
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`${fixture.origin}/test/task-scroll-anchor.html`);
  const anchorScroll = page.getByTestId("scroll");
  await expect(anchorScroll).toBeVisible();
  await anchorScroll.evaluate((e) => {
    e.scrollTop = 300;
  });
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Scroll during refresh" }).click();
  await expect.poll(() => anchorScroll.evaluate((e) => e.scrollTop)).toBe(340);
  await page
    .getByRole("button", { name: "Scroll back during refresh" })
    .click();
  await expect.poll(() => anchorScroll.evaluate((e) => e.scrollTop)).toBe(300);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
    });
  for (const scope of ["global", "room"]) {
    await page.goto(
      scope === "global"
        ? `${fixture.origin}/?surface=tasks`
        : `${fixture.origin}/?room=${taskRoomId}&roomTab=tasks`,
    );
    if (scope === "room") {
      const home = page.locator(".rah-room-sidebar.is-open");
      if (await home.isVisible())
        await home
          .locator(`[data-sidebar-key="room:${taskRoomId}"] button`)
          .first()
          .tap();
      await page.getByRole("tab", { name: "任务", exact: true }).tap();
    }
    for (const mode of ["列表", "看板"]) {
      await page.getByRole("radio", { name: mode, exact: true }).tap();
      const scroll = page.locator("[data-task-virtual-scroll]");
      const card = page.locator(".rah-global-card-open").first();
      await expect(card)
        .toBeVisible()
        .catch(async (e) => {
          console.log(await page.locator("body").innerText());
          throw e;
        });
      await scroll.evaluate((e) => {
        e.scrollTop = 0;
        e.scrollLeft = 0;
      });
      const box = await card.boundingBox(),
        x = box.x + box.width / 2,
        y = Math.min(box.y + box.height - 8, 620);
      await touch("touchStart", x, y);
      await page.waitForTimeout(300);
      const pressedTransform = await card.evaluate(
        (e) => getComputedStyle(e.closest(".kcard")).transform,
      );
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", x, y - i * 12);
        await page.waitForTimeout(25);
      }
      await touch("touchEnd", x, y - 96);
      console.log(`${scope}/${mode}: touch transform ${pressedTransform}`);
      assert.ok(
        pressedTransform === "none" ||
          pressedTransform === "matrix(1, 0, 0, 1, 0, 0)",
        "Holding a task card to scroll must not lift or depress the card",
      );
      await expect
        .poll(() => scroll.evaluate((e) => e.scrollTop))
        .toBeGreaterThan(30);
      await expect(
        page.locator(".rah-global-task-drag-shell.is-dragging"),
      ).toHaveCount(0);
      await page.waitForTimeout(300);
      const beforeReverse = await scroll.evaluate((e) => e.scrollTop);
      const viewport = await scroll.boundingBox();
      const reverseY = Math.max(viewport.y + 40, 260);
      await touch("touchStart", x, reverseY);
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", x, reverseY + i * 8);
        await page.waitForTimeout(25);
      }
      await touch("touchEnd", x, reverseY + 64);
      await expect
        .poll(() => scroll.evaluate((e) => e.scrollTop))
        .toBeLessThan(beforeReverse - 20);
      if (mode === "看板") {
        await scroll.evaluate((e) => {
          e.scrollTop = 0;
          e.scrollLeft = 0;
        });
        const a = await card.boundingBox(),
          sx = Math.min(a.x + a.width - 10, 330),
          sy = a.y + a.height / 2;
        await touch("touchStart", sx, sy);
        for (let i = 1; i <= 8; i++) {
          await touch("touchMove", sx - i * 12, sy);
          await page.waitForTimeout(25);
        }
        await touch("touchEnd", sx - 96, sy);
        await expect
          .poll(() => scroll.evaluate((e) => e.scrollLeft))
          .toBeGreaterThan(30);
      }
      console.log(
        `${scope}/${mode}: native swipe from card scrolls after hold`,
      );
    }
  }
  // Use a fresh desktop page: mobile inertial scroll is still active after swipe.
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  desktop.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v3/client/tasks/workflow")
      changes.push(request.url());
  });
  await desktop.goto(`${fixture.origin}/?room=${taskRoomId}&roomTab=tasks`);
  const card = desktop.locator(".rah-global-card-open").first();
  await expect(card).toBeVisible();
  await card.hover();
  const box = await card.boundingBox();
  await desktop.mouse.down();
  await desktop.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 20,
    { steps: 4 },
  );
  await expect(
    desktop.locator(".rah-global-task-drag-shell.is-dragging"),
  ).toHaveCount(1);
  await desktop.keyboard.press("Escape");
  await desktop.mouse.up();
  const handle = desktop.getByRole("button", { name: /^移动任务/ }).first();
  await handle.focus();
  await desktop.keyboard.press("Space");
  await expect(
    desktop.locator(".rah-global-task-drag-shell.is-dragging"),
  ).toHaveCount(1);
  await desktop.keyboard.press("Escape");
  await expect(
    desktop.locator(".rah-global-task-drag-shell.is-dragging"),
  ).toHaveCount(0);
  assert.deepEqual(
    changes,
    [],
    "swipes and cancelled drags never mutate task state",
  );
  console.log("Desktop mouse/keyboard drag activation and cancellation passed");
} finally {
  await browser.close();
  await fixture.close();
}
