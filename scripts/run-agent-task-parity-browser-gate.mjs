import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, firefox, expect } from "playwright/test";
import { roleBrowserFixture } from "./role-browser-fixture.mjs";
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
    const { post, workspace, channel, createRole, instantiate } =
      await roleBrowserFixture(page, fixture);
    const home = await channel(`fake-parity-${engine}`);
    const role = await createRole(`ParityFixture${engine}`);
    const instance = await instantiate(role, home);
    const id = instance.agentId;
    for (const width of [1440, 390]) {
      console.log(`Checking ${engine} ${width}`);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${fixture.origin}/?surface=computers`);
      await page.locator(".rah-computer-row").click();
      await page
        .locator(".rah-computer-runtime-chips button")
        .first()
        .waitFor({ timeout: 30000 })
        .catch(async (error) => {
          writeFileSync(
            join(output, `${engine}-${width}-failure.txt`),
            await page.locator("body").innerText(),
          );
          console.error("Failure evidence", output);
          throw error;
        });
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
      const headerAction = async (name) => {
        await head.waitFor();
        const button = head.getByRole("button", { name, exact: true });
        if (await button.isVisible()) await button.click();
        else {
          await head
            .getByRole("button", { name: "更多操作", exact: true })
            .click();
          await page.getByRole("menuitem", { name, exact: true }).click();
        }
      };
      await headerAction("停止 Agent");
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
        (await post("agents/get", { agentId: id })).agent.definition.state,
        "disabled",
      );
      await headerAction("启动 Agent");
      await expect(
        page.getByRole("dialog", { name: "启动 Agent", exact: true }),
      ).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await post("agents/get", { agentId: id })).agent.definition.state,
        )
        .toBe("enabled");
      await headerAction("重启 / 重置");
      await page.getByRole("dialog", { name: /^重新启动/ }).waitFor();
      await page.keyboard.press("Escape");
      const actions = page.locator(".rah-agent-actions-section");
      await actions
        .getByRole("button", { name: "删除 Agent", exact: true })
        .click();
      const remove = page.getByRole("dialog", {
        name: "删除 Agent",
        exact: true,
      });
      await expect(remove).toContainText("这会移除 Agent 身份及关联权限");
      await expect(
        remove.getByRole("button", { name: "删除 Agent", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      assert.equal(
        (await post("agents/get", { agentId: id })).agent.definition.state,
        "enabled",
        "cancel deletion preserves the instance",
      );
      await page.screenshot({
        path: join(output, `${engine}-${width}-agent.png`),
      });
      await page.goto(`${fixture.origin}/?room=${home.roomId}&roomTab=tasks`);
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      await page
        .getByRole("textbox", { name: "任务 1", exact: true })
        .fill(`Isolated task ${engine} ${width}`);
      const form = page.getByRole("dialog");
      assert.equal(
        await form.getByText(/配置负责人与依赖|前置任务|任务负责人/).count(),
        0,
      );
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
      assert.equal(request.assigneeId, undefined);
      assert.deepEqual(request.dependencyTaskIds, []);
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
    // Role instances always belong to a channel; use a separate disposable
    // channel to exercise the existing lifecycle without touching task history.
    const disposableHome = await channel(`fake-disposable-${engine}`);
    const disposableRole = await createRole(`Disposable${engine}`);
    const disposable = await instantiate(disposableRole, disposableHome);
    const disposableId = disposable.agentId;
    await page.setViewportSize({ width: 1440, height: 900 });
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
      ).agents.some((agent) => agent.definition.agentId === disposableId),
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
