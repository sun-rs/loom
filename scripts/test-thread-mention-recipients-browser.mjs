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
  await p.waitForTimeout(500); // Wait for the task root/draft identity to finish loading.
  await approvalReply.fill(`@${target.handle} approval fixture`);
  const approvalSent = p.waitForResponse(
    (r) =>
      r.url().endsWith("/threads/reply") &&
      r.request().method() === "POST" &&
      r.status() === 200,
  );
  await approvalReply.press("Enter");
  const approvalResponse = await approvalSent;
  assert.deepEqual(approvalResponse.request().postDataJSON().recipientIds, [
    target.definition.participantId,
  ]);
  assert.equal(approvalResponse.status(), 200, await approvalResponse.text());
  console.log(
    "PASS mention subscribes only one Agent, plain replies preserve followers, reload persists",
  );
} finally {
  await b.close();
  await f.close();
}
