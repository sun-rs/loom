// Real temporary Core; native UI with canonical task/thread data. No paid CLI.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { openChannelWithHistory, openChatRow } from "./mobile-chat-browser.mjs";
export async function verifyTaskPresentation({
  browser,
  origin,
  client,
  workspace,
  head,
  instances,
  role,
}) {
  const out =
    process.env.LOOM_TASK_REPAIR_OUT ?? "/tmp/loom-task-presentation-browser";
  await mkdir(out, { recursive: true });
  for (const instance of instances)
    await client.request("agent.manage", {
      action: "set_state",
      agentId: instance.agentId,
      state: "disabled",
      basedOnRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: `task-presentation-disable-${instance.agentId}`,
    });
  const results = [];
  for (const width of [1440, 390]) {
    const room = (
      await client.request("room.create", {
        workspaceId: workspace.workspaceId,
        kind: "channel",
        name: `FIXTURE presentation ${width}`,
        slug: `presentation-${width}`,
        basedOnControlRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `presentation-room-${width}`,
      })
    ).room;
    const task = (
      await client.request("task.create", {
        roomId: room.roomId,
        title: `FIXTURE task ${width}`,
        dependencyTaskIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `presentation-task-${width}`,
      })
    ).task;
    await client.request("task.workflow.update", {
      taskId: task.taskId,
      workflowStatus: "in_review",
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `presentation-state-${width}`,
    });
    for (let i = 0; i < 5; i++)
      await client.request("thread.reply", {
        roomId: room.roomId,
        threadId: task.threadId,
        body: `FIXTURE preview ${i}`,
        recipientIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `presentation-reply-${width}-${i}`,
      });
    const reference = await client.request("message.post", {
      roomId: room.roomId,
      body: `FIXTURE reference task #${task.taskNumber}`,
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `presentation-ref-${width}`,
    });
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      locale: "zh-CN",
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    const errors = [],
      previewRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().endsWith("/v3/client/threads/list"))
        previewRequests.push(r.postDataJSON());
    });
    try {
      if (width === 390) {
        await page.goto(origin + "/?chat=list");
        await openChatRow(page, room.roomId);
      } else await openChannelWithHistory(page, origin, room.roomId);
      const ref = page
        .locator(`#message-${reference.event.aggregateId}`)
        .getByTestId("message-task-ref-badge");
      await ref.waitFor();
      assert.equal(await ref.getAttribute("data-status"), "in_review");
      const root = page.locator(`#message-${task.sourceMessageId}`),
        preview = root.locator(
          '[data-message-affordance="inline-thread-replies"]',
        );
      await preview.waitFor();
      assert.equal(
        await preview.locator("[data-inline-thread-reply-row]").count(),
        3,
      );
      const text = await preview.innerText();
      assert.ok(text.includes("5 条回复"), text);
      assert.ok(
        text.includes("FIXTURE preview 2") &&
          text.includes("FIXTURE preview 4"),
        text,
      );
      assert.ok(!text.includes("FIXTURE preview 0"));
      assert.ok(
        previewRequests.some((r) =>
          r.previewRootMessageIds?.includes(task.sourceMessageId),
        ),
      );
      const taskColor = await ref.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      await page.screenshot({ path: `${out}/channel-${width}.png` });
      await ref.click();
      await page
        .getByTestId("task-thread-modal")
        .getByTestId("task-modal-title")
        .waitFor();
      assert.ok(page.url().includes(`task=${task.taskId}`));
      await page
        .getByTestId(
          width === 390 ? "task-modal-mobile-back" : "task-modal-close",
        )
        .click();
      await preview.click();
      await page.getByTestId("thread-side-column").waitFor();
      await page.goto(origin + "/?view=activity");
      const row = page.locator(`[data-inbox-key="thread:${task.threadId}"]`),
        badge = row.getByTestId("conversation-card-task-badge");
      await badge.waitFor();
      assert.equal(await badge.getAttribute("data-status"), "in-review");
      assert.equal((await badge.innerText()).trim(), `#${task.taskNumber}`);
      assert.equal(
        await row
          .getByTestId("conversation-card-channel-badge")
          .locator("svg")
          .count(),
        1,
      );
      assert.equal(await row.locator('[data-slot="icon-tile"] svg').count(), 1);
      await page.screenshot({ path: `${out}/activity-${width}.png` });
      const activityColor = await badge.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      // A known task update reuses the same UI tokens, never a colour guessed from text.
      await row.getByTestId("inbox-row-open").click();
      await page
        .getByTestId(
          width === 390 ? "thread-side-column" : "activity-thread-content",
        )
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("thread"),
        task.sourceMessageId,
      );
      let activity = "online";
      await page.route("**/v3/client/agents/presence/list", async (route) => {
        const response = await route.fetch(),
          data = await response.json();
        data.agents = data.agents.map((p) => ({
          ...p,
          activity: instances.some((i) => i.agentId === p.agentId)
            ? activity
            : p.activity,
        }));
        await route.fulfill({ response, json: data });
      });
      // Deterministic Host observation only for badge wiring; no provider is started.
      await page.goto(origin + "/?view=agents");
      const roleDot = page
        .locator(`[data-role-id="${role.roleId}"]`)
        .getByTestId("role-presence");
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(
              `[data-role-id="${id}"] [data-testid="role-presence"]`,
            )
            ?.getAttribute("data-state") === "online",
        role.roleId,
      );
      const roleOnlineColor = await roleDot.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      activity = "offline";
      await page.reload();
      await page.waitForFunction(
        (id) =>
          document
            .querySelector(
              `[data-role-id="${id}"] [data-testid="role-presence"]`,
            )
            ?.getAttribute("data-state") === "offline",
        role.roleId,
      );
      const roleOfflineColor = await roleDot.evaluate(
        (e) => getComputedStyle(e).backgroundColor,
      );
      assert.notEqual(roleOnlineColor, roleOfflineColor);
      assert.deepEqual(errors, []);
      results.push({
        width,
        taskReference: true,
        latestThreeReplyPreview: true,
        previewOpensThread: true,
        activityTaskOpensBoundConversation: true,
        activityTaskStatus: true,
        nativeLeadingAndCorner: true,
        taskColor,
        activityColor,
        roleOnlineColor,
        roleOfflineColor,
        pageErrors: errors,
      });
    } catch (error) {
      await page.screenshot({ path: `${out}/failure-${width}.png` });
      throw error;
    } finally {
      await ctx.close();
    }
  }
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(
      {
        results,
        paidCalls: 0,
        scope:
          "Canonical task/thread Core data; only Role Host connectivity observations are stubbed for colour transitions.",
      },
      null,
      2,
    ) + "\n",
  );
  return results;
}
