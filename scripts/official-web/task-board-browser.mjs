import assert from "node:assert/strict";
async function drag(page, title) {
  const card = page
    .getByTestId("task-board-draggable-card")
    .filter({ hasText: title });
  const start = await card.boundingBox();
  const heading = page.getByRole("button", {
    name: "收起进行中",
    exact: true,
  });
  const end = await heading.boundingBox();
  assert.ok(start && end);
  const x = start.x + 70,
    y = start.y + 35,
    target = Math.min(end.x + 40, await page.evaluate(() => innerWidth - 12));
  if ((await page.evaluate(() => innerWidth)) === 390) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(230);
    for (let i = 1; i <= 15; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + ((target - x) * i) / 15, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(target, y, { steps: 15 });
    await page.mouse.up();
  }
  // Native dnd-kit removes its click-capture listener 50 ms after drag end.
  await page.waitForTimeout(75);
}
export async function verifyTaskBoard({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const room = (
      await client.request("room.create", {
        workspaceId: workspace.workspaceId,
        kind: "channel",
        name: `FIXTURE board ${width}`,
        slug: `fixture-board-${width}`,
        basedOnControlRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `board-room-${width}`,
      })
    ).room;
    const title = `FIXTURE drag ${width}`;
    const task = (
      await client.request("task.create", {
        roomId: room.roomId,
        title,
        dependencyTaskIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `board-task-${width}`,
      })
    ).task;
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
    });
    try {
      const page = await context.newPage(),
        errors = [],
        calls = [];
      page.setDefaultTimeout(8000);
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/v3/client/tasks/workflow", async (route) => {
        calls.push(route.request().postDataJSON());
        if (calls.length === 1) {
          await route.fetch();
          await route.abort("failed");
        } else {
          const response = await route.fetch();
          if (response.status() !== 200)
            console.log(
              "FIXTURE workflow verification",
              response.status(),
              await response.text(),
            );
          await route.fulfill({ response });
        }
      });
      await page.goto(
        origin + `/?room=${room.roomId}&chatTab=tasks&taskView=board`,
      );
      await page
        .getByTestId("task-board-draggable-card")
        .filter({ hasText: title })
        .waitFor();
      await drag(page, title);
      await page
        .getByRole("button", { name: "核实任务操作", exact: true })
        .waitFor();
      assert.equal(calls.length, 1);
      await page
        .getByRole("button", { name: "核实任务操作", exact: true })
        .click();
      await page
        .getByRole("button", { name: "核实任务操作", exact: true })
        .waitFor({ state: "detached" });
      assert.deepEqual(calls[0], calls[1]);
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: task.taskId,
          })
        ).task.state,
        "in_progress",
      );
      await page.getByTestId("channel-task-view-list").click();
      const card = page
        .locator('[data-slot="task-card"]')
        .filter({ hasText: title });
      await card.getByRole("button", { name: "进行中", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByTestId("task-status-menu").waitFor({ state: "detached" });
      assert.equal(
        await card
          .getByRole("button", { name: "进行中", exact: true })
          .evaluate((el) => el === document.activeElement),
        true,
      );
      await card.getByRole("button", { name: "进行中", exact: true }).click();
      const reviewed = page.waitForResponse(
        (r) =>
          r.url().endsWith("/v3/client/tasks/workflow") && r.status() === 200,
      );
      await page.getByTestId("task-status-option-in_review").click();
      await reviewed;
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: task.taskId,
          })
        ).task.state,
        "submitted",
      );
      await page.goto(
        origin + `/?view=tasks&taskRoom=${room.roomId}&taskView=list`,
      );
      await card.getByRole("button", { name: "待确认", exact: true }).click();
      const completed = page.waitForResponse(
        (r) =>
          r.url().endsWith("/v3/client/tasks/workflow") && r.status() === 200,
      );
      await page.getByTestId("task-status-option-done").click();
      await completed;
      await page.getByRole("button", { name: "展开完成", exact: true }).click();
      await card.waitFor();
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: task.taskId,
          })
        ).task.state,
        "completed",
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        drag: true,
        input: width === 390 ? "touch" : "mouse",
        unknownExactRetry: true,
        channelList: true,
        globalList: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
