import { showChatList } from "./mobile-chat-browser.mjs";
import assert from "node:assert/strict";
// Temporary Core only. No actual CLI execution.
export async function verifyChannelControls({
  browser,
  origin,
  client,
  channel,
}) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?room=${channel.roomId}`);
    await page
      .getByTestId("loom-channel-control-trigger")
      .click({ timeout: 5000 });
    await page.getByTestId("channel-overflow-stop-agents").click();
    const dialog = page.getByTestId("loom-sos-dialog");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    const before = await client.request("room.execution.read", {
      roomId: channel.roomId,
    });
    assert.ok(!before.operation || before.operation.state === "resumed");
    await page.getByTestId("loom-channel-control-trigger").click();
    await page.getByTestId("channel-overflow-stop-agents").click();
    let original;
    await page.route("**/v3/client/rooms/sos/stop", async (route) => {
      original = route.request().postDataJSON();
      await route.fetch();
      await route.abort();
    });
    await dialog.getByRole("button", { name: "确认急停", exact: true }).click();
    await dialog.getByRole("button", { name: "核实操作结果" }).waitFor();
    await page.keyboard.press("Escape");
    assert.ok(await dialog.isVisible());
    await page.unroute("**/v3/client/rooms/sos/stop");
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/rooms/sos/stop"),
    );
    await dialog.getByRole("button", { name: "核实操作结果" }).click();
    assert.deepEqual((await request).postDataJSON(), original);
    await dialog.getByText("频道已停止", { exact: true }).waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "恢复频道", exact: true })
        .isEnabled(),
      false,
    );
    await dialog.getByRole("button", { name: "保持停止", exact: true }).click();
    await page.reload();
    await page.getByTestId("loom-channel-control-trigger").click();
    await page.getByTestId("channel-overflow-stop-agents").click();
    await dialog.getByLabel("恢复指引").fill("FIXTURE 仅恢复频道，不执行任务");
    await dialog.getByRole("button", { name: "恢复频道", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      (await client.request("room.execution.read", { roomId: channel.roomId }))
        .operation,
      null,
    );
    await showChatList(page);
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    const input = page.getByLabel("本机同时运行上限", { exact: true });
    await input.waitFor();
    const initial = await client.request("runtime.settings.read", {});
    const next = initial.maxConcurrentRuns === 3 ? 4 : 3;
    await input.fill(String(next));
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page
      .getByText("已保存；只影响之后的调度。", { exact: true })
      .waitFor();
    assert.equal(
      (await client.request("runtime.settings.read", {})).maxConcurrentRuns,
      next,
    );
    // A foreign update must never be overwritten by this stale editor.
    const current = await client.request("runtime.settings.read", {});
    await client.request("runtime.settings.update", {
      expectedRevision: current.revision,
      maxConcurrentRuns: 5,
    });
    await input.fill("6");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      (await client.request("runtime.settings.read", {})).maxConcurrentRuns,
      5,
    );
    assert.equal(await input.inputValue(), "6");
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="本机同时运行上限"]')
          ?.value === "5",
    );
    // A committed settings response is lost: do not silently resend or dismiss it through history.
    let updates = 0;
    await page.route("**/v3/client/runtime-settings/update", async (route) => {
      updates++;
      await route.fetch();
      await route.abort();
    });
    await input.fill("7");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: "放弃核实并重新读取" }).waitFor();
    await page.goBack();
    await page
      .getByRole("button", { name: "放弃核实并重新读取" })
      .waitFor({ timeout: 5000 });
    assert.equal(updates, 1);
    await page.getByRole("button", { name: "放弃核实并重新读取" }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[aria-label="本机同时运行上限"]')
          ?.value === "7",
    );
    await page.unroute("**/v3/client/runtime-settings/update");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      stopResume: true,
      unknownExactReplay: true,
      reloadStopped: true,
      settingsSave: true,
      revisionConflictPreservesDraft: true,
    });
    await context.close();
  }
  return results;
}
