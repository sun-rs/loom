import assert from "node:assert/strict";
export async function verifyMessageMetrics({
  browser,
  origin,
  client,
  workspace,
  channels,
  instances,
  head,
}) {
  const room = channels[2];
  const post = async (roomId, body, key) => {
    await client.request("message.post", {
      roomId,
      body,
      recipients: [],
      basedOnRoomSeq: await head(roomId),
      idempotencyKey: key,
    });
    return (
      await client.request("message.list", { roomId, limit: 20 })
    ).messages.find((m) => m.body === body);
  };
  const root = await post(
    room.roomId,
    `FIXTURE typography #${room.name}`,
    "metrics-root",
  );
  const thread = (
    await client.request("thread.create", {
      roomId: room.roomId,
      rootMessageId: root.messageId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: "metrics-thread",
    })
  ).thread;
  await client.request("thread.reply", {
    roomId: room.roomId,
    threadId: thread.threadId,
    body: "FIXTURE thread typography",
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "metrics-reply",
  });
  const peer = (
    await client.request("agent.list", {
      controlRoomId: workspace.controlRoomId,
    })
  ).agents.find((a) => a.definition.agentId === instances[0].agentId).definition
    .participantId;
  const direct = (
    await client.request("room.direct.open", {
      workspaceId: workspace.workspaceId,
      peerPrincipalId: peer,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "metrics-direct",
    })
  ).room;
  await post(direct.roomId, "FIXTURE private typography", "metrics-private");
  const task = (
    await client.request("task.create", {
      roomId: room.roomId,
      title: "FIXTURE metrics task",
      description: "FIXTURE task description",
      dependencyTaskIds: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: "metrics-task",
    })
  ).task;
  const taskThread = (
    await client.request("thread.list", { roomId: room.roomId })
  ).threads.find((t) => t.rootMessageId === task.sourceMessageId);
  await client.request("thread.reply", {
    roomId: room.roomId,
    threadId: taskThread.threadId,
    body: "FIXTURE task reply typography",
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "metrics-task-reply",
  });
  const result = [];
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    try {
      const page = await ctx.newPage();
      page.setDefaultTimeout(5000);
      for (const [size, expected] of [
        ["sm", 14],
        ["md", 16],
        ["lg", 18],
      ]) {
        await page.goto(origin + "/?view=settings&settings=appearance");
        await page.getByTestId("message-font-size-" + size).click();
        for (const [kind, query, text] of [
          ["channel", `room=${room.roomId}`, "FIXTURE typography"],
          ["private", `room=${direct.roomId}`, "FIXTURE private typography"],
          [
            "thread",
            `room=${room.roomId}&thread=${root.messageId}`,
            "FIXTURE thread typography",
          ],
          [
            "task",
            `view=tasks&taskChannel=${room.roomId}&task=${task.taskId}`,
            "FIXTURE task reply typography",
          ],
        ]) {
          await page.goto(origin + "/?" + query);
          const body = page
            .locator('[data-slot="message-item-body"]')
            .filter({ hasText: text })
            .first();
          await body.waitFor();
          const metrics = await body.evaluate((el) => {
            const row = el.closest('[data-slot="message-item"]');
            const avatar = row?.querySelector('[data-slot="avatar"]');
            return {
              font: parseFloat(getComputedStyle(el).fontSize),
              family: getComputedStyle(el).fontFamily,
              avatarContext: avatar?.getAttribute("data-avatar-context"),
              avatarCss: avatar ? getComputedStyle(avatar).width : null,
              avatar: avatar
                ? {
                    w: avatar.getBoundingClientRect().width,
                    h: avatar.getBoundingClientRect().height,
                  }
                : null,
            };
          });
          assert.equal(metrics.font, expected, kind + " " + size);
          assert.ok(metrics.avatar, "first fixture message has native avatar");
          assert.deepEqual(metrics.avatar, {
            w: size === "lg" ? 34 : 35,
            h: size === "lg" ? 34 : 35,
          });
          if (kind === "task") {
            assert.equal(
              await page
                .getByTestId("task-modal-description")
                .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
              15,
              "official task description text-subhead",
            );
          }
          result.push({ width, size, kind, ...metrics });
        }
      }
    } finally {
      await ctx.close();
    }
  }
  return result;
}
