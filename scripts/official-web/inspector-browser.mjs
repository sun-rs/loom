import { verifyBlockedWork } from "./blocked-work-browser.mjs";
import {
  verifyRunDetails,
  verifyRuntimeControl,
} from "./run-details-browser.mjs";
import assert from "node:assert/strict";
export async function verifyInspector({
  page,
  client,
  agentId,
  agentAvatar,
  composer,
  viewport,
  name,
  instanceId,
  roomId,
}) {
  const mutations = [];
  const observe = (request) => {
    if (
      /\/(?:messages\/post|agents\/manage|instances\/(?:restart|remove)|rooms\/direct\/open|activity\/mark)/.test(
        new URL(request.url()).pathname,
      )
    )
      mutations.push(request.url());
  };
  page.on("request", observe);
  await composer.fill("FIXTURE unsent draft");
  await agentAvatar.click();
  const panel = page.getByTestId("profile-panel");
  await panel.waitFor();
  assert.deepEqual(await panel.getByRole("tab").allTextContents(), [
    "动态",
    "资料",
  ]);
  const more = panel.getByRole("button", {
    name: `更多操作 ${name}`,
    exact: true,
  });
  await more.click();
  await page.getByRole("menuitem", { name: "私聊", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("menuitem", { name: "私聊", exact: true })
    .waitFor({ state: "hidden" });
  await panel.getByRole("tab", { name: "动态", exact: true }).focus();
  assert.equal(
    await panel.locator('[data-slot="conversation-panel-tabs"]').count(),
    1,
  );
  assert.equal(
    await panel
      .getByRole("button", {
        name: "关闭实例详情",
        exact: true,
        includeHidden: true,
      })
      .getAttribute("data-slot"),
    "panel-action",
  );
  if (viewport.width < 1024)
    assert.equal(await panel.getByTestId("loom-inspector-resize").count(), 0);

  assert.equal(await page.getByTestId("loom-message-profile").count(), 0);
  assert.equal(
    await panel
      .getByRole("tab", { name: "动态" })
      .getAttribute("aria-selected"),
    "true",
  );
  await panel.getByTestId("loom-instance-activity").waitFor();
  assert.equal(
    await panel
      .getByRole("button", { name: `更多操作 ${name}`, exact: true })
      .getAttribute("data-slot"),
    "panel-action",
  );

  assert.ok((await panel.innerText()).includes(name));
  assert.ok((await panel.innerText()).includes("本频道无排队工作"));
  const box = await panel.boundingBox();
  if (viewport.width >= 1024) assert.equal(Math.round(box.width), 380);
  else assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
  await page.screenshot({
    path: `/tmp/loom-inspector-${viewport.width}.png`,
    animations: "disabled",
  });
  if (viewport.width >= 1024) {
    const handle = panel.getByTestId("loom-inspector-resize");
    const rect = await handle.boundingBox();
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    assert.equal(
      await page.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.getAttribute("data-testid"),
        { x, y },
      ),
      "loom-inspector-resize",
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 50, y, { steps: 5 });
    await page.mouse.up();
    assert.ok((await panel.boundingBox()).width > box.width + 30);
  }
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await composer.inputValue(), "FIXTURE unsent draft");
  assert.equal(
    await agentAvatar.evaluate((el) => document.activeElement === el),
    true,
  );
  await agentAvatar.focus();
  await page.keyboard.press("Enter");
  await panel.waitFor();
  if (viewport.width < 768)
    await panel.getByRole("button", { name: "返回聊天" }).click();
  else await panel.getByRole("button", { name: "关闭实例详情" }).click();
  await panel.waitFor({ state: "hidden" });
  // Failure must clear a previously loaded projection and recover without a write.
  await agentAvatar.click();
  await panel.getByTestId("loom-instance-activity").waitFor();
  await page.route("**/v3/client/agents/activity/list", (route) =>
    route.abort(),
  );
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.getByTestId("loom-instance-activity").count(), 0);
  await page.unroute("**/v3/client/agents/activity/list");
  await panel.getByTestId("loom-instance-activity").waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  // Explicit diagnostic response fixture, never a fabricated provider run.
  const record = (id, room, actor, eventType) => ({
    activityId: id,
    createdAt: "2026-10-15T01:00:00Z",
    participantId: actor,
    relation: "runtime",
    roomId: room,
    roomKind: "channel",
    roomName: "FIXTURE",
    roomSlug: "fixture",
    tone: "neutral",
    aggregateId: id,
    aggregateType: "run_attempt",
    eventType,
    roomSeq: 1,
    source: "room_event",
  });
  await page.route("**/v3/client/agents/activity/list", async (route) => {
    const older = route.request().postDataJSON().beforeActivityId;
    await route.fulfill({
      json: older
        ? {
            activities: [
              record("fixture-old", roomId, instanceId, "run.finished"),
            ],
          }
        : {
            activities: [
              record("fixture-new", roomId, instanceId, "run.started"),
              record(
                "fixture-private",
                "private-room",
                instanceId,
                "run.finished",
              ),
              record("fixture-other", roomId, "other-instance", "run.finished"),
            ],
            nextCursor: "fixture-old-cursor",
          },
    });
  });
  await agentAvatar.click();
  await panel.getByText("运行开始", { exact: true }).waitFor();
  assert.equal(await panel.getByTestId("loom-run-record").count(), 1);
  await verifyRunDetails(page, panel, { roomId, instanceId, agentId });
  await panel.getByRole("button", { name: "更早记录" }).click();
  await panel.getByText("运行结束", { exact: true }).waitFor();
  assert.equal(await panel.getByText("运行开始", { exact: true }).count(), 0);
  await panel.getByRole("button", { name: "最新记录" }).click();
  await panel.getByText("运行开始", { exact: true }).waitFor();
  await page.screenshot({
    path: `/tmp/loom-inspector-records-${viewport.width}.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  await page.unroute("**/v3/client/agents/activity/list");
  let release, started, completed;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const observed = new Promise((resolve) => {
    started = resolve;
  });
  const settled = new Promise((resolve) => {
    completed = resolve;
  });
  await page.route("**/v3/client/agents/activity/list", async (route) => {
    started();
    await gate;
    try {
      await route.fulfill({ json: { activities: [] } });
    } finally {
      completed();
    }
  });
  await agentAvatar.click();
  await observed;
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  release();
  await settled;
  assert.equal(
    await panel.count(),
    0,
    "late read cannot reopen a closed inspector",
  );
  await page.unroute("**/v3/client/agents/activity/list");
  assert.equal(await composer.inputValue(), "FIXTURE unsent draft");
  assert.deepEqual(mutations, [], "inspector is read-only");
  page.off("request", observe);
  await agentAvatar.click();
  await panel.getByTestId("loom-instance-activity").waitFor();
  await verifyRuntimeControl(page, panel, { client, agentId, name, roomId });
  await verifyBlockedWork(page, panel, {
    instanceId,
    roomId,
    viewport,
    name,
  });
  // Native focus-return Tooltip may own the first Escape; close the actual
  // control surface explicitly here. Standalone inspector Escape is tested above.
  await panel
    .getByRole("button", {
      name: viewport.width < 768 ? "返回聊天" : "关闭实例详情",
      exact: true,
    })
    .click();
  await panel.waitFor({ state: "hidden" });
  await composer.fill("");
}
