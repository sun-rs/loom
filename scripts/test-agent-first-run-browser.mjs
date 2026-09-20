import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FAKE_FIRST_RUN_DELAY_MS = "6000";
const fixture = await startShellFixture();
const browserName =
  process.env.RAH_BROWSER === "webkit" ? "webkit" : "chromium";
const browser = await { chromium, webkit }[browserName].launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const post = async (path, data) => {
    const r = await page.request.post(`${fixture.origin}/v3/client/${path}`, {
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId: workspace.controlRoomId,
        consumerId: "first-run-gate",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  let all = (
    await post("rooms/list", { workspaceId: workspace.workspaceId })
  ).rooms.find((r) => r.slug === "all");
  if (!all)
    all = (
      await post("rooms/create", {
        workspaceId: workspace.workspaceId,
        basedOnControlRoomSeq: await head(),
        kind: "channel",
        visibility: "public",
        name: "all",
        slug: "all",
        idempotencyKey: crypto.randomUUID(),
      })
    ).room;
  const old = (
    await post("agents/list", { controlRoomId: workspace.controlRoomId })
  ).agents[0];
  const detail = await post("agents/get", {
    agentId: old.definition.agentId,
  });
  const create = async (name) => {
    const input = {
      controlRoomId: workspace.controlRoomId,
      basedOnRoomSeq: await head(),
      displayName: name,
      handle: name,
      role: "Fixture first-run Agent",
      instructions: "Isolated Fake CLI fixture.",
      runtimeOfferId: detail.policy.required.allowedOfferIds[0],
      modelIntent: detail.policy.modelIntent,
      sessionPolicy: "prefer_resume",
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await post("agents/provision", input);
    assert.equal((await post("agents/provision", input)).deduplicated, true);
    return result.agent;
  };
  const events = async () =>
    (
      await post("rooms/sync", {
        roomId: all.roomId,
        consumerId: "first-run-evidence",
        afterSeq: 0,
      })
    ).events;
  await page.goto(`${fixture.origin}/?room=${all.roomId}`);
  const created = await create("GreetingFixture");
  await expect(
    page
      .getByTestId("live-agent-activity-bar")
      .getByRole("img", { name: "GreetingFixture 头像" }),
  ).toBeVisible({
    timeout: 65000,
  });
  await expect(page.getByTestId("live-agent-activity-bar")).toHaveAttribute(
    "title",
    "等待初始化…",
  );
  await page.screenshot({
    path: `/tmp/rah-first-run-${browserName}-queued.png`,
  });
  await expect(page.getByTestId("live-agent-activity-bar")).toHaveAttribute(
    "title",
    /正在启动|工作中/,
    { timeout: 65000 },
  );
  const footer = page.getByTestId("live-agent-activity-bar");
  assert.deepEqual(
    await footer.evaluate((element) => ({
      avatarDots: element.querySelectorAll(".rah-agent-avatar-presence").length,
      statusDots: element.querySelectorAll(".rah-live-agent-activity-dot")
        .length,
    })),
    { avatarDots: 0, statusDots: 1 },
  );
  await page.screenshot({
    path: `/tmp/rah-first-run-${browserName}-working.png`,
  });
  await expect
    .poll(
      async () =>
        (await events()).filter(
          (e) =>
            e.type === "message.posted" &&
            e.actorId === created.definition.participantId,
        ).length,
      { timeout: 65000 },
    )
    .toBe(1);
  const rows = await events();
  assert.equal(
    rows.filter(
      (e) =>
        e.type === "agent.first_run_requested" &&
        e.payload.participantId === created.definition.participantId,
    ).length,
    1,
  );
  assert.equal(rows.filter((e) => e.type === "task.created").length, 0);
  await page.goto(`${fixture.origin}/?room=${all.roomId}`);
  await expect(
    page.getByText("[Fake CLI fixture] Hello from a newly created Agent.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  const toggle = page.getByRole("checkbox", { name: "新 Agent 在 #all 报到" });
  await expect(toggle).toHaveCount(0);
  const final = await events();
  assert.equal(
    final.filter(
      (e) =>
        e.type === "message.posted" &&
        e.actorId === created.definition.participantId,
    ).length,
    1,
  );
  console.log(
    "First-run AgentHost/Fake CLI greeting, replay dedupe, no Task, always-on initialization and no settings toggle passed.",
  );
} finally {
  await browser.close();
  await fixture.close();
}
