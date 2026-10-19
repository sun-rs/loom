// FIXTURE: real Kernel/application service, fake Worker identity; no paid CLI.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { HttpRahClient } from "@rah-os/client-sdk";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
} from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const width of [1440, 390]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  try {
    const work = startInstanceRun(f);
    work.finish(0);
    service = new ClientApplicationService({
      human: createHumanApplicationPort(f.kernel),
      health: () => {
        throw Error("not used");
      },
    });
    await service.start();
    gateway = new LocalWorkbenchGateway({
      accessToken: f.owner.accessToken,
      daemonOrigin: service.origin,
      port: 0,
      sessionToken: "x".repeat(43),
      staticDirectory: resolve("frontends/raft/packages/web/dist-workbench"),
    });
    await gateway.start();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      isMobile: width === 390,
      hasTouch: width === 390,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    await page.goto(gateway.origin + "/?room=" + f.home.roomId);
    const openTask = async () => {
      await page.getByTestId("loom-channel-control-trigger").click();
      await page
        .getByRole("button", { name: "实例任务权限", exact: true })
        .click();
      await page
        .getByRole("switch", { name: "允许实例自主创建任务", exact: true })
        .waitFor();
    };
    await openTask();
    const dialog = page.getByRole("dialog", {
      name: "实例任务权限",
      exact: true,
    });
    assert.equal(
      await dialog.getByRole("switch").getAttribute("aria-checked"),
      "false",
    );
    await dialog.getByRole("switch").click();
    let original;
    await page.route("**/v3/client/rooms/update", async (route) => {
      original = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await dialog
      .getByRole("button", { name: "保存任务权限", exact: true })
      .click();
    await dialog.getByText(/结果未知/).waitFor();
    await page.unroute("**/v3/client/rooms/update");
    const replay = page.waitForRequest((r) =>
      r.url().endsWith("/rooms/update"),
    );
    await dialog.getByRole("button", { name: "核实原操作" }).click();
    assert.deepEqual((await replay).postDataJSON(), original);
    await dialog.waitFor({ state: "detached" });
    await openTask();
    assert.equal(
      await dialog.getByRole("switch").getAttribute("aria-checked"),
      "true",
    );
    await dialog.getByRole("switch").click();
    await client.request("room.update", {
      roomId: f.home.roomId,
      name: "FIXTURE renamed",
      visibility: "private",
      description: "preserve new description",
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "concurrent-rename",
    });
    await dialog
      .getByRole("button", { name: "保存任务权限", exact: true })
      .click();
    await dialog.getByText(/设置未保存/).waitFor();
    await dialog
      .getByRole("button", { name: "重新读取设置", exact: true })
      .click();
    await dialog.getByRole("switch").locator("visible=true").waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[role="switch"][aria-label="允许实例自主创建任务"]')
          ?.getAttribute("aria-checked") === "true",
    );
    await dialog.getByRole("switch").click();
    await dialog
      .getByRole("button", { name: "保存任务权限", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    const room = (
      await client.request("room.list", { workspaceId: f.home.workspaceId })
    ).rooms.find((r) => r.roomId === f.home.roomId);
    assert.equal(room.name, "FIXTURE renamed");
    assert.equal(room.description, "preserve new description");
    assert.equal(room.allowInstanceTaskCreation, false);
    await page.goto(gateway.origin + "/?view=settings&settings=usage");
    const summary = page.getByTestId("loom-usage-summary");
    await summary.getByRole("table").waitFor();
    await summary.getByText("Reviewer-1", { exact: true }).waitFor();
    assert.ok((await summary.innerText()).includes("未知"));
    await page.screenshot({ path: `/tmp/loom-closeout-usage-${width}.png` });
    const request = page.waitForRequest((r) =>
      r.url().endsWith("/usage/summary"),
    );
    await summary.getByText("最近 7 天", { exact: true }).click();
    const input = (await request).postDataJSON();
    assert.equal(Date.parse(input.to) - Date.parse(input.from), 7 * 86400000);
    await summary.getByRole("table").waitFor();
    await page.goto(gateway.origin + "/?room=" + f.home.roomId);
    await page.getByTestId("loom-channel-control-trigger").click();
    await page
      .getByTestId("loom-channel-control-sheet")
      .getByRole("button", { name: /^Reviewer-1/ })
      .click();
    await page.getByText(/当前会话累计压缩：未知/).waitFor();
    await page.getByTestId("loom-run-record").first().click();
    await page
      .getByRole("dialog", { name: "运行用量", exact: true })
      .getByText("进程清扫", { exact: true })
      .waitFor();
    await page.screenshot({ path: `/tmp/loom-closeout-run-${width}.png` });
    assert.deepEqual(errors, []);
    results.push({
      width,
      taskUnknownReplay: true,
      staleMetadataPreserved: true,
      summaryWindow: true,
      unknownNotZero: true,
      sessionCompactions: true,
      runDiagnostics: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results));
