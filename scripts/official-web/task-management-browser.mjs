import assert from "node:assert/strict";
export async function verifyTaskManagement({
  browser,
  origin,
  client,
  workspace,
  head,
  role,
}) {
  const room = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "FIXTURE task management",
      slug: "fixture-task-management",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "task-management-room",
    })
  ).room;
  const member = await client.request("role.instantiate", {
    roleId: role.roleId,
    channelId: room.roomId,
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "task-management-member",
  });
  await client.request("agent.manage", {
    action: "set_state",
    agentId: member.instance.agentId,
    state: "disabled",
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "task-management-disable",
  });
  const me = (await client.request("principal.me", {})).principal;
  const results = [];
  for (const width of [1440, 390]) {
    const task = (
      await client.request("task.create", {
        roomId: room.roomId,
        title: `FIXTURE assignment ${width}`,
        dependencyTaskIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `management-task-${width}`,
      })
    ).task;
    for (let i = 0; i < 26; i++) {
      await client.request("task.assign", {
        taskId: task.taskId,
        assigneeId: me.principalId,
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `history-assign-${width}-${i}`,
      });
      await client.request("task.unassign", {
        taskId: task.taskId,
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `history-unassign-${width}-${i}`,
      });
    }
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
        assigns = [],
        unassigns = [],
        histories = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      page.on("request", (r) => {
        if (r.url().endsWith("/tasks/history"))
          histories.push(r.postDataJSON());
      });
      for (const [operation, calls] of [
        ["assign", assigns],
        ["unassign", unassigns],
      ])
        await page.route(`**/v3/client/tasks/${operation}`, async (route) => {
          calls.push(route.request().postDataJSON());
          if (calls.length === 1) {
            await route.fetch();
            await route.abort();
          } else await route.continue();
        });
      const url = `${origin}/?view=tasks&taskRoom=${room.roomId}&task=${task.taskId}&taskChannel=${room.roomId}`;
      await page.goto(url);
      const modal = page.getByTestId("task-thread-modal"),
        assignee = modal.getByTestId("task-properties-assignee");
      await assignee.waitFor();
      assert.equal(
        histories.length,
        0,
        "collapsed history performs no request",
      );
      await assignee.click();
      const picker = page.getByTestId("task-assignee-dropdown");
      await picker.waitFor();
      await picker.getByRole("textbox").fill("escape check");
      await page.keyboard.press("Escape");
      await picker.waitFor({ state: "detached", timeout: 3000 });
      assert.equal(await modal.count(), 1);
      assert.equal(
        await assignee.evaluate((el) => document.activeElement === el),
        true,
      );
      await assignee.click();
      await picker.waitFor();
      await picker.getByRole("textbox").fill(member.agent.handle);
      await picker
        .getByRole("button", {
          name: member.agent.displayName ?? member.agent.handle,
          exact: true,
        })
        .click();
      const verify = page.getByRole("button", {
        name: "核实负责人修改",
        exact: true,
      });
      await verify.waitFor();
      assert.equal(assigns.length, 1);
      await page.keyboard.press("Escape");
      assert.equal(await modal.count(), 1);
      await verify.click();
      await verify.waitFor({ state: "detached" });
      assert.deepEqual(assigns[0], assigns[1]);
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: task.taskId,
          })
        ).task.assigneeId,
        member.instance.instanceId,
      );
      await assignee.click();
      await picker
        .getByRole("button", { name: /^(Unassigned|未指派)$/ })
        .click();
      await verify.waitFor();
      await verify.click();
      await verify.waitFor({ state: "detached" });
      assert.deepEqual(unassigns[0], unassigns[1]);
      assert.equal(
        (
          await client.request("task.get", {
            roomId: room.roomId,
            taskId: task.taskId,
          })
        ).task.assigneeId,
        undefined,
      );
      await assignee.click();
      await picker.getByRole("textbox").fill(me.displayName ?? me.handle);
      await picker
        .getByRole("button", { name: me.displayName ?? me.handle, exact: true })
        .click();
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="task-properties-assignee"]')
          ?.textContent.includes("owner"),
      );
      await modal.getByTestId("task-history-toggle").click();
      const history = modal.getByTestId("task-history");
      await history.getByTestId("timeline").waitFor();
      assert.equal(histories.length, 1);
      assert.equal(histories[0].limit, 50);
      await history
        .getByRole("button", { name: "加载更早历史", exact: true })
        .click();
      await history.getByTestId("timeline").waitFor();
      assert.equal(histories.length, 2);
      assert.ok(histories[1].cursor);
      await history.getByText(/^(Created task|创建任务|任务已创建)$/).waitFor();
      await page.screenshot({
        path: `/tmp/loom-task-management-${width}.png`,
        animations: "disabled",
      });
      await history.getByTestId("task-history-toggle").click();
      await page.route("**/v3/client/tasks/history", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "forbidden", message: "FIXTURE denied" },
          }),
        }),
      );
      await history.getByTestId("task-history-toggle").click();
      await history.getByRole("alert").waitFor();
      assert.equal(await history.getByTestId("timeline").count(), 0);
      await page.unroute("**/v3/client/tasks/history");
      await history.getByTestId("task-history-toggle").click();
      await history.getByTestId("task-history-toggle").click();
      await history.getByTestId("timeline").waitFor();
      await history.getByTestId("task-history-toggle").click();
      await client.request("task.workflow.update", {
        taskId: task.taskId,
        workflowStatus: "done",
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `management-done-${width}`,
      });
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="task-properties-assignee"]')
            ?.disabled === true,
      );
      await page.reload();
      await assignee.waitFor();
      assert.equal(await assignee.isDisabled(), true);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        agentAndHumanAssignment: true,
        unassignment: true,
        exactLostResponseReplay: true,
        unknownCloseGuard: true,
        completedReadonly: true,
        nativeSearchablePicker: true,
        pickerEscapeAndFocusReturn: true,
        collapsedHistoryNoRead: true,
        frozenHistoryPagination: true,
        historyDenialRecovery: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
