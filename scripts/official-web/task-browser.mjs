import assert from "node:assert/strict";
export async function verifyTasks({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const room = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "FIXTURE Tasks",
      slug: "fixture-tasks",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "task-ui-room",
    })
  ).room;
  for (let i = 0; i < 53; i++)
    await client.request("task.create", {
      roomId: room.roomId,
      title: `FIXTURE task ${i}`,
      description: "FIXTURE deliverable",
      dependencyTaskIds: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `task-${i}`,
    });
  const selected = (
    await client.request("task.list", { roomId: room.roomId, limit: 100 })
  ).tasks.find((t) => t.title === "FIXTURE task 52");
  const emptyRoom = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "FIXTURE no tasks",
      slug: "fixture-no-tasks",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "task-ui-empty-room",
    })
  ).room;
  const results = [];
  for (const width of [1440, 390]) {
    if (width === 390)
      await client.request("task.workflow.update", {
        taskId: selected.taskId,
        workflowStatus: "todo",
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: "reset-task-ui-mobile",
      });
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage(),
        errors = [],
        external = [],
        writes = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      const url = `${origin}/?view=tasks&taskRoom=${room.roomId}`;
      await page.goto(url);
      await page.getByRole("heading", { name: "任务", exact: true }).waitFor();
      await page.getByText("FIXTURE task 52", { exact: true }).waitFor();
      // Card editing is connected now; mutations are covered by task-board-browser.
      // This slice owns pagination, detail navigation and unknown-result recovery.
      assert.equal(
        await page
          .getByTestId(
            width === 390
              ? "channel-task-list-view"
              : "channel-task-board-view",
          )
          .count(),
        1,
      );
      await page.getByTestId("channel-task-view-list").click();
      await page
        .getByRole("button", { name: "加载更多任务", exact: true })
        .click();
      const viewport = page.locator("[data-task-virtual-scroll]");
      await viewport.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await page.getByText("FIXTURE task 0", { exact: true }).waitFor();
      await viewport.evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.getByText("FIXTURE task 52", { exact: true }).click();
      const modal = page.getByTestId("task-thread-modal");
      await modal.getByTestId("task-modal-title").waitFor();
      assert.equal(
        await modal.getByTestId("task-modal-title").innerText(),
        "FIXTURE task 52",
      );
      assert.equal(
        await modal.getByTestId("thread-panel-parent").count(),
        0,
        "native task header replaces duplicate root",
      );
      const status = modal.getByTestId("task-properties-status");
      await page.route("**/v3/client/tasks/workflow", async (route) => {
        writes.push(route.request().postDataJSON());
        if (writes.length === 1) {
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await status.click();
      await page.getByTestId(`task-properties-status-option-done`).click();
      const verify = modal.getByRole("button", { name: "核实状态修改" });
      await verify.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await modal.count(), 1);
      const frozenUrl = page.url();
      await page.goBack();
      await page.waitForURL(frozenUrl);
      await verify.click();
      await verify.waitFor({ state: "hidden" });
      assert.deepEqual(writes[0], writes[1]);
      const current = (
        await client.request("task.get", {
          roomId: room.roomId,
          taskId: selected.taskId,
        })
      ).task;
      assert.equal(current.state, "completed");
      const input = modal.getByTestId("composer-textarea");
      await input.fill(`FIXTURE task discussion ${width}`);
      await input.press("Enter");
      await modal
        .getByText(`FIXTURE task discussion ${width}`, { exact: true })
        .waitFor();
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: selected.taskId,
          })
        ).task.state,
        current.state,
        "discussion reply does not complete or reopen a task",
      );
      await page.reload();
      await modal
        .getByText(`FIXTURE task discussion ${width}`, { exact: true })
        .waitFor();
      await page.screenshot({
        path: `/tmp/loom-task-detail-${width}.png`,
        animations: "disabled",
      });
      await modal
        .getByTestId(
          width === 390 ? "task-modal-mobile-back" : "task-modal-close",
        )
        .click();
      await modal.waitFor({ state: "detached" });
      await page.screenshot({
        path: `/tmp/loom-tasks-${width}.png`,
        animations: "disabled",
      });
      // A denied detail read hides stale task content and its discussion without losing the draft.
      await page.goto(
        `${url}&task=${selected.taskId}&taskChannel=${room.roomId}`,
      );
      await modal.getByTestId("task-modal-title").waitFor();
      await modal
        .getByTestId("composer-textarea")
        .fill("FIXTURE task retained draft");
      await page.route("**/v3/client/tasks/get", (r) =>
        r.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "forbidden", message: "FIXTURE denied" },
          }),
        }),
      );
      await modal
        .getByText("任务暂时无法读取，请重试。", { exact: true })
        .waitFor();
      assert.equal(await modal.getByTestId("task-modal-title").count(), 0);
      assert.equal(
        await modal
          .getByText(`FIXTURE task discussion ${width}`, { exact: true })
          .count(),
        0,
      );
      assert.equal(
        await modal.getByTestId("composer-textarea").inputValue(),
        "FIXTURE task retained draft",
      );
      await page.unroute("**/v3/client/tasks/get");
      await modal.getByTestId("task-modal-title").waitFor();
      assert.equal(
        await modal.getByTestId("composer-textarea").inputValue(),
        "FIXTURE task retained draft",
      );
      await page.goto(
        `${url}&task=${selected.taskId}&taskChannel=not-the-room`,
      );
      await modal
        .getByText("任务暂时无法读取，请重试。", { exact: true })
        .waitFor();
      assert.equal(await modal.getByTestId("composer-textarea").count(), 0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await modal
        .getByTestId(
          width === 390 ? "task-modal-mobile-back" : "task-modal-close",
        )
        .click();
      await modal.waitFor({ state: "detached" });
      // Native multi-select keeps the popover open; clear only this facet.
      await page.getByRole("button", { name: "筛选频道", exact: true }).click();
      await page
        .getByTestId("task-filter-频道")
        .getByRole("button", { name: "清除", exact: true })
        .click();
      await page
        .getByRole("button", { name: `#${emptyRoom.name}`, exact: true })
        .click();
      await page.keyboard.press("Escape");
      await page.getByText("暂无任务", { exact: true }).waitFor();
      assert.deepEqual(new URL(page.url()).searchParams.getAll("taskRoom"), [
        emptyRoom.roomId,
      ]);
      await page.getByRole("button", { name: "筛选频道", exact: true }).click();
      await page
        .getByRole("button", { name: `#${room.name}`, exact: true })
        .click();
      assert.deepEqual(new URL(page.url()).searchParams.getAll("taskRoom"), [
        emptyRoom.roomId,
        room.roomId,
      ]);
      await page.keyboard.press("Escape");
      await page.getByText("FIXTURE task 51", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "筛选创建者", exact: true })
        .click();
      await page.getByRole("button", { name: "我创建的", exact: true }).click();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "筛选负责人", exact: true })
        .click();
      await page.screenshot({
        animations: "disabled",
        path: `/tmp/loom-task-filter-${width}.png`,
      });
      await page.getByRole("button", { name: "未分配", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByTestId("task-filter-负责人").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") === "筛选负责人",
      );
      await page
        .getByRole("button", { name: "加载更多任务", exact: true })
        .click();
      const filteredUrl = page.url();
      await page.reload();
      await page.getByText("FIXTURE task 51", { exact: true }).waitFor();
      assert.equal(page.url(), filteredUrl);
      await page
        .getByRole("button", { name: "筛选负责人", exact: true })
        .click();
      await page
        .getByRole("button", { name: "分配给我的", exact: true })
        .click();
      await page.getByRole("button", { name: "未分配", exact: true }).click();
      await page.keyboard.press("Escape");
      await page.getByText("暂无任务", { exact: true }).waitFor();
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
      await page.getByText("FIXTURE task 51", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.has("taskAssignee"), false);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        nativeBoardAndList: true,
        boundedPagination: true,
        nativeMultiFiltersReloadAndClear: true,
        taskDetailAndDiscussion: true,
        canonicalStatusUpdate: true,
        unknownExactReplay: true,
        unknownHistoryGuard: true,
        reload: true,
        mobileReturnOrClose: true,
        foreignTaskRejected: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
