import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const post = async (path, data) => {
    const r = await p.request.post(f.origin + "/v3/client/" + path, { data });
    if (r.status() === 409 && data.basedOnRoomSeq !== undefined) {
      const sync = await post("rooms/sync", {
        roomId: data.roomId,
        consumerId: "mention-retry",
        bootstrap: "latest",
      });
      return post(path, { ...data, basedOnRoomSeq: sync.latestRoomSeq });
    }
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const w = (await post("workspaces/list", {})).workspaces[0];
  const agents = (await post("agents/list", { controlRoomId: w.controlRoomId }))
    .agents;
  assert.ok(agents.length > 1);
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId: f.roomId,
        consumerId: "mention-fixture",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  for (const agent of agents.slice(1))
    await post("rooms/members/add", {
      roomId: f.roomId,
      principalId: agent.definition.participantId,
      role: "member",
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    });
  const root = await post("messages/post", {
    roomId: f.roomId,
    body: "Isolated focused thread",
    recipients: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const rootId = root.event.payload.messageId ?? root.event.aggregateId;
  const thread = (
    await post("threads/create", {
      roomId: f.roomId,
      rootMessageId: rootId,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  for (let i = 0; i < 18; i++)
    await post("threads/reply", {
      roomId: f.roomId,
      threadId: thread.threadId,
      body: `History entry ${i}`,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    });
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: 844 });
    await p.goto(`${f.origin}/?room=${f.roomId}`);
    await p.locator(`[data-message-id="${rootId}"] .thread-preview`).click();
    const initialScroller = p.locator(".thread > .messages");
    await expect(
      initialScroller.getByText("History entry 17", { exact: true }),
    ).toBeAttached();
    await expect
      .poll(() =>
        initialScroller.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(4);
    await p.screenshot({ path: `/tmp/thread-initial-latest-${width}.png` });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${f.origin}/?room=${f.roomId}&thread=${f.roomId}:${rootId}`);
  const reply = p.getByRole("textbox", {
    name: "Thread 回复输入框",
    exact: true,
  });
  const target = agents[0];
  for (const [body, expected] of [
    [`@${target.handle}`, [target.definition.participantId]],
    ["Plain reply without mention", []],
  ]) {
    const scroller = p.locator(".thread > .messages");
    await expect(scroller.getByText(/History entry 17/)).toBeAttached();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(500);
    await scroller.hover();
    await p.mouse.wheel(0, -10000);
    await scroller.evaluate((el) => {
      el.scrollTop = 100;
    });
    await reply.fill(body);
    await reply.press("Escape");
    const sent = p.waitForResponse(
      (r) =>
        r.url().endsWith("/threads/reply") &&
        r.request().method() === "POST" &&
        r.status() === 200,
    );
    await reply.press("Enter");
    const response = await sent;
    assert.deepEqual(response.request().postDataJSON().recipientIds, expected);
    assert.equal(response.status(), 200, await response.text());
    await expect(reply).toHaveValue("");
    await expect
      .poll(() =>
        scroller.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(4);
    const followers = await post("activity/thread-followers", {
      roomId: f.roomId,
      threadId: thread.threadId,
    });
    assert.deepEqual(followers.agentParticipantIds, [
      target.definition.participantId,
    ]);
  }
  await p.reload();
  await expect(
    p.getByRole("textbox", { name: "Thread 回复输入框", exact: true }),
  ).toBeVisible();
  const followers = await post("activity/thread-followers", {
    roomId: f.roomId,
    threadId: thread.threadId,
  });
  assert.deepEqual(followers.agentParticipantIds, [
    target.definition.participantId,
  ]);
  await post("tasks/create", {
    roomId: f.roomId,
    title: "Approval mention fixture",
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  await p.goto(`${f.origin}/?room=${f.roomId}`);
  const badge = p.getByTestId("message-task-badge").first();
  await badge.click();
  const approval = p.getByTestId("task-thread-modal");
  const approvalReply = approval.getByRole("textbox", {
    name: "Thread 回复输入框",
    exact: true,
  });
  await expect(approvalReply).toBeEnabled();
  await p.waitForTimeout(500); // Allow the fixture task context and draft identity to arrive.
  await approvalReply.fill(
    `@${target.handle} approval fixture\n\n` +
      "Long approval reply\n\n".repeat(80),
  );
  await p.screenshot({ path: "/tmp/send-before-approval.png" });
  const approvalSent = p.waitForResponse(
    (r) =>
      r.url().endsWith("/threads/reply") &&
      r.request().method() === "POST" &&
      r.status() === 200,
  );
  const [approvalResponse] = await Promise.all([
    approvalSent,
    approval.locator("button[type=submit]").click(),
  ]);
  assert.deepEqual(approvalResponse.request().postDataJSON().recipientIds, [
    target.definition.participantId,
  ]);
  assert.equal(approvalResponse.status(), 200, await approvalResponse.text());
  await expect
    .poll(() =>
      approval
        .locator(".rah-thread-task-body")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThan(4);
  const control = await post("rooms/sync", {
    roomId: w.controlRoomId,
    consumerId: "send-scroll",
    bootstrap: "latest",
  });
  const dm = (
    await post("rooms/direct/open", {
      workspaceId: w.workspaceId,
      peerPrincipalId: target.definition.participantId,
      basedOnControlRoomSeq: control.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  for (const roomId of [f.roomId, dm.roomId]) {
    for (let i = 0; i < 36; i++) {
      const sync = await post("rooms/sync", {
        roomId,
        consumerId: "send-scroll",
        bootstrap: "latest",
      });
      await post("messages/post", {
        roomId,
        body: `Scroll history ${i}`,
        recipients: [],
        basedOnRoomSeq: sync.latestRoomSeq,
        idempotencyKey: crypto.randomUUID(),
      });
    }
    await p.goto(`${f.origin}/?room=${roomId}`);
    const input = p.getByRole("textbox", { name: "消息输入框", exact: true });
    const scroll = p.locator(".channel .chan-pane > .messages");
    await expect(input).toBeEnabled();
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(500);
    await scroll.hover();
    await p.mouse.wheel(0, -10000);
    await scroll.evaluate((el) => {
      el.scrollTop = 100;
    });
    await input.fill("Own send returns to latest");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect
      .poll(() =>
        scroll.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
        ),
      )
      .toBeLessThan(4);
  }
  console.log(
    "PASS channel, DM, thread and task approval send align to latest; mention recipient regression preserved",
  );
} catch (error) {
  console.error(error);
  for (const page of b.contexts().flatMap((c) => c.pages()))
    await page.screenshot({ path: "/tmp/send-scroll-failure.png" });
  throw error;
} finally {
  await b.close();
  await f.close();
}
