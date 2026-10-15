import assert from "node:assert/strict";
// HTTP diagnostic fixtures only; never presented as actual CLI work.
export async function verifyRunDetails(
  page,
  panel,
  { roomId, instanceId, agentId },
) {
  const usage = {
    runAttemptId: "fixture-new",
    completeness: "partial",
    gaps: [],
    generations: [],
    totals: {
      generations: 1,
      inputTokens: 123,
      cachedInputTokens: 0,
      outputTokens: null,
      reasoningOutputTokens: null,
    },
    truncated: false,
    processCleanups: [],
    compactionCount: null,
  };
  await page.route("**/v3/client/agents/run-usage/get", async (route) => {
    assert.deepEqual(route.request().postDataJSON(), {
      agentId,
      runAttemptId: "fixture-new",
    });
    await route.fulfill({ json: usage });
  });
  await panel.getByTestId("loom-run-record").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("loom-run-usage").waitFor();
  assert.equal(
    await dialog.locator('[data-usage-field="输入 token"]').innerText(),
    "123（部分）",
  );
  assert.equal(
    await dialog.locator('[data-usage-field="输出 token"]').innerText(),
    "未知",
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await panel.count(), 1);
  await page.unroute("**/v3/client/agents/run-usage/get");
  await page.route("**/v3/client/agents/run-usage/get", (route) =>
    route.abort(),
  );
  await panel.getByTestId("loom-run-record").click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await dialog.getByTestId("loom-run-usage").count(), 0);
  await page.unroute("**/v3/client/agents/run-usage/get");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const record = (id, room, actor, seq) => ({
    activityId: id,
    roomId: room,
    participantId: actor,
    serverSequence: seq,
    producerSequence: seq,
    observedAt: "2026-10-15T01:00:00Z",
    recordedAt: "2026-10-15T01:00:00Z",
    runAttemptId: "fixture-new",
    runtimeRunId: "fixture-runtime",
    entry: {
      kind: "tool_start",
      toolName: id,
      toolInput: "FIXTURE tool argument",
    },
  });
  await page.route("**/v3/client/agents/trajectory/list", async (route) => {
    const input = route.request().postDataJSON();
    assert.equal(input.agentId, agentId);
    assert.equal(input.limit, 50);
    await route.fulfill({
      json: input.beforeActivityId
        ? { activities: [record("fixture-old-tool", roomId, instanceId, 1)] }
        : {
            activities: [
              record("fixture-tool", roomId, instanceId, 2),
              {
                ...record("fixture-thinking", roomId, instanceId, 5),
                entry: {
                  kind: "thinking",
                  text: "FIXTURE thinking ".repeat(40),
                },
              },
              record("SECRET-tool", "other-room", instanceId, 3),
              record("OTHER-tool", roomId, "other-instance", 4),
            ],
            nextCursor: "fixture-trajectory-cursor",
          },
    });
  });
  await panel.getByText("fixture-tool", { exact: true }).waitFor();
  assert.equal(await panel.getByTestId("loom-trajectory-row").count(), 2);
  const tool = panel.getByRole("button", { name: "思考", exact: true });
  assert.equal(await tool.getAttribute("aria-expanded"), "false");
  await tool.click();
  assert.equal(await tool.getAttribute("aria-expanded"), "true");
  await panel.getByRole("button", { name: "更早轨迹" }).click();
  await panel.getByText("fixture-old-tool", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "最新轨迹" }).click();
  await tool.waitFor();
  await page.unroute("**/v3/client/agents/trajectory/list");
}
export async function verifyRuntimeControl(
  page,
  panel,
  { client, agentId, name, roomId },
) {
  const before = (await client.request("agent.get", { agentId })).agent;
  assert.equal(before.definition.state, "disabled");
  const open = () =>
    panel
      .getByRole("button", { name: `更多操作 ${name}`, exact: true })
      .click();
  await open();
  await page.getByRole("menuitem", { name: "启用实例", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await panel.count(), 1);
  assert.equal(
    (await client.request("agent.get", { agentId })).agent.definition.state,
    "disabled",
  );
  await open();
  await page.getByRole("menuitem", { name: "启用实例", exact: true }).click();
  await dialog.getByRole("button", { name: "启用实例", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(
    (await client.request("agent.get", { agentId })).agent.definition.state,
    "enabled",
  );
  const stopRequests = [];
  await page.route("**/v3/client/agents/manage", async (route) => {
    stopRequests.push(route.request().postDataJSON());
    if (stopRequests.length === 1) {
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      await route.abort();
    } else await route.continue();
  });
  await open();
  await page.getByRole("menuitem", { name: "停止实例", exact: true }).click();
  await dialog.getByRole("button", { name: "停止实例", exact: true }).click();
  await dialog.getByRole("button", { name: "核实操作结果" }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true);
  assert.equal(
    await dialog
      .getByRole("button", { name: "停止实例", exact: true })
      .isDisabled(),
    true,
  );
  await page.route("**/v3/client/rooms/sync", (route) =>
    route.request().postDataJSON().roomId === roomId
      ? route.abort()
      : route.continue(),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="profile-panel"]') ||
      document.querySelectorAll('[role="alert"]').length >= 2,
  );
  assert.equal(
    await panel.isVisible(),
    true,
    "a transient conversation failure must not discard the unresolved control intent",
  );
  assert.equal(await dialog.isVisible(), true);
  await page.unroute("**/v3/client/rooms/sync");
  await dialog.getByRole("button", { name: "核实操作结果" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(stopRequests.length, 2);
  assert.deepEqual(stopRequests[0], stopRequests[1]);
  await page.unroute("**/v3/client/agents/manage");
  const after = (await client.request("agent.get", { agentId })).agent;
  assert.equal(after.definition.state, "disabled");
  assert.equal(after.definition.participantId, before.definition.participantId);
  assert.equal(
    after.definition.currentRevisionId,
    before.definition.currentRevisionId,
  );
}
