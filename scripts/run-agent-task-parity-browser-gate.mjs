import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = mkdtempSync(join(tmpdir(), "rah-agent-task-parity-"));
const results = [];
for (const engine of ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    page.setDefaultTimeout(12_000);
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    const post = async (path, data) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const workspace = (await post("workspaces/list", {})).workspaces[0];
    const agent = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents[0];
    const id = agent.definition.agentDefinitionId;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${fixture.origin}/?surface=computers`);
      await page
        .locator(".rah-computer-runtime-chips button")
        .first()
        .waitFor();
      for (const chip of await page
        .locator(".rah-computer-runtime-chips button")
        .all())
        assert.equal(
          await chip.getAttribute("aria-label"),
          `${(await chip.textContent()).trim()} Runtime 详情`,
        );
      await page.goto(
        `${fixture.origin}/?surface=agents&agent=${id}&agentTab=profile`,
      );
      const head = page.locator(".rah-agent-detail-head");
      await head
        .getByRole("button", { name: "停止 Agent", exact: true })
        .click();
      const stop = page.getByRole("dialog", {
        name: "停止 Agent",
        exact: true,
      });
      const stateRequests = [];
      await page.route("**/v3/client/agents/manage", async (route) => {
        stateRequests.push(route.request().postDataJSON());
        if (stateRequests.length === 1)
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "unavailable",
                message: "Isolated state retry fixture",
              },
            }),
          });
        return route.continue();
      });
      await stop
        .getByRole("button", { name: "停止 Agent", exact: true })
        .click();
      await stop.getByRole("alert").waitFor();
      await stop
        .getByRole("button", { name: "停止 Agent", exact: true })
        .click();
      await stop.waitFor({ state: "hidden" });
      assert.equal(stateRequests.length, 2);
      assert.equal(
        stateRequests[0].idempotencyKey,
        stateRequests[1].idempotencyKey,
      );
      await page.unroute("**/v3/client/agents/manage");
      assert.equal(
        (await post("agents/get", { agentDefinitionId: id })).agent.definition
          .state,
        "disabled",
      );
      await head
        .getByRole("button", { name: "启动 Agent", exact: true })
        .click();
      const start = page.getByRole("dialog", {
        name: "启动 Agent",
        exact: true,
      });
      await start
        .getByRole("button", { name: "启动 Agent", exact: true })
        .click();
      await start.waitFor({ state: "hidden" });
      assert.equal(
        (await post("agents/get", { agentDefinitionId: id })).agent.definition
          .state,
        "enabled",
      );
      await head
        .getByRole("button", { name: "重启 / 重置", exact: true })
        .click();
      await page.getByRole("dialog", { name: /^重启/ }).waitFor();
      await page.keyboard.press("Escape");
      const actions = page.locator(".rah-agent-actions-section");
      await actions
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      const remove = page.getByRole("dialog", {
        name: "删除 Agent",
        exact: true,
      });
      await remove.getByText("请先停止 Agent，再确认删除。").waitFor();
      assert.equal(
        await remove
          .getByRole("button", { name: "删除 Agent", exact: true })
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: join(output, `${engine}-${width}-agent.png`),
      });
      await page.goto(
        `${fixture.origin}/?room=${fixture.roomId}&roomTab=tasks`,
      );
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      await page
        .getByRole("textbox", { name: "任务 1", exact: true })
        .fill(`Isolated task ${engine} ${width}`);
      await page
        .getByRole("button", { name: "配置负责人与依赖", exact: true })
        .click();
      const form = page.getByRole("dialog");
      assert.equal(
        await form.getByText(/审阅者|协作者|任务协作角色/).count(),
        0,
      );
      await form
        .getByRole("combobox", { name: "任务负责人", exact: true })
        .waitFor();
      await page.screenshot({
        path: join(output, `${engine}-${width}-task.png`),
      });
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/v3/client/tasks/create") &&
          response.request().method() === "POST",
      );
      await form.getByRole("button", { name: "创建任务", exact: true }).click();
      const accepted = await created;
      assert.equal(accepted.status(), 200);
      const request = accepted.request().postDataJSON();
      const task = (await accepted.json()).task;
      assert.deepEqual(request.reviewerIds, []);
      assert.deepEqual(request.collaboratorIds, []);
      assert.deepEqual(task.reviewerIds, []);
      assert.deepEqual(task.collaboratorIds, []);
      const manifest = await (
        await page.request.get(`${fixture.origin}/manifest.webmanifest`)
      ).json();
      for (const size of [192, 512]) {
        const icon = manifest.icons.find(
          (icon) =>
            icon.type === "image/png" && icon.sizes === `${size}x${size}`,
        );
        assert.ok(icon);
        const response = await page.request.get(`${fixture.origin}${icon.src}`);
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-type"], /image\/png/);
        const bytes = await response.body();
        assert.equal(bytes.readUInt32BE(16), size);
        assert.equal(bytes.readUInt32BE(20), size);
      }
      results.push({
        engine,
        width,
        stateActions: true,
        taskRolesAbsent: true,
        pngRoutes: true,
      });
    }
    // A disposable, Room-less Agent proves direct deletion without disturbing
    // the legacy Review fixture or treating an active task as disposable data.
    const inventoryResponse = await page.request.post(
      `${fixture.origin}/v1/local/runtimes/list`,
      { data: {} },
    );
    assert.equal(inventoryResponse.status(), 200);
    const runtime = (await inventoryResponse.json()).runtimes.find(
      (runtime) => runtime.available && runtime.runtimeOfferId,
    );
    const detail = await post("agents/get", { agentDefinitionId: id });
    const head = await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: `delete-fixture-${engine}`,
      limit: 1,
    });
    const disposable = await post("agents/provision", {
      controlRoomId: workspace.controlRoomId,
      basedOnRoomSeq: head.latestRoomSeq,
      displayName: "Disposable UI Agent",
      handle: `disposable-${engine}`,
      instructions: "Isolated lifecycle fixture",
      role: "assistant",
      runtimeOfferId: runtime.runtimeOfferId,
      modelIntent: detail.policy.modelIntent,
      idempotencyKey: `disposable-ui-agent-${engine}`,
    });
    const disposableId = disposable.agent.definition.agentDefinitionId;
    await page.goto(
      `${fixture.origin}/?surface=agents&agent=${disposableId}&agentTab=profile`,
    );
    await page
      .locator(".rah-agent-detail-head")
      .getByRole("button", { name: "停止 Agent", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "停止 Agent", exact: true })
      .getByRole("button", { name: "停止 Agent", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page
      .locator(".rah-agent-actions-section")
      .getByRole("button", { name: "删除 Agent", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除 Agent", exact: true })
      .getByRole("button", { name: "删除 Agent", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      (
        await post("agents/list", { controlRoomId: workspace.controlRoomId })
      ).agents.some(
        (agent) => agent.definition.agentDefinitionId === disposableId,
      ),
      false,
    );
    results.push({ engine, directDeletion: true });
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(join(output, "result.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, results }));
