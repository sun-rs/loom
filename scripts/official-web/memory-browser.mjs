// FIXTURE: real Kernel/application service, fake Worker identity; no paid CLI.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
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
    const written = f.kernel.memory.write(work.execution, {
      name: "fixture-memory",
      type: "project",
      description: "FIXTURE description",
      body: "FIXTURE body searchable unicorn",
      idempotencyKey: "fixture-memory",
    });
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
    await page.goto(gateway.origin + "/?view=memory");
    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "记忆操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("dialog");
    await edit
      .getByRole("textbox", { name: "记忆正文" })
      .fill("FIXTURE edited searchable unicorn");
    await edit
      .getByRole("textbox", { name: "简介", exact: true })
      .fill("FIXTURE edited description");
    let editInput;
    await page.route("**/v3/client/memory/update", async (route) => {
      editInput = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await edit.getByRole("button", { name: "保存记忆", exact: true }).click();
    await edit.getByText(/保存结果未知/).waitFor();
    await page.unroute("**/v3/client/memory/update");
    const editReplay = page.waitForRequest((r) =>
      r.url().endsWith("/memory/update"),
    );
    await edit.getByRole("button", { name: "核实原操作" }).click();
    assert.deepEqual((await editReplay).postDataJSON(), editInput);
    await edit.waitFor({ state: "detached" });
    await page
      .getByText("FIXTURE edited searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "记忆操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
    await page.getByText(/修订 3/).waitFor();
    await page.screenshot({ path: `/tmp/loom-memory-detail-${width}.png` });
    await page.getByRole("button", { name: "记忆操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "标为失效", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "原因" })
      .fill("FIXTURE invalidation");
    await page.getByRole("button", { name: "确认失效", exact: true }).click();
    await page.getByText(/修订 4/).waitFor();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "记忆操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "恢复", exact: true }).click();
    await page.getByText(/修订 5/).waitFor();
    if (width === 390)
      await page.getByRole("button", { name: "记忆列表", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索记忆" }).fill("unicorn");
    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page
      .getByText("FIXTURE edited searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "记忆操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "原因" }).fill("FIXTURE cleanup");
    let original;
    await page.route("**/v3/client/memory/delete", async (route) => {
      original = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await dialog.getByText(/操作结果未知/).waitFor();
    await page.unroute("**/v3/client/memory/delete");
    const replay = page.waitForRequest((r) =>
      r.url().endsWith("/memory/delete"),
    );
    await dialog.getByRole("button", { name: "核实原操作" }).click();
    assert.deepEqual((await replay).postDataJSON(), original);
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      f.kernel.memory.humanRead(f.actor, { entryId: written.entryId }).entry
        .body,
      null,
    );
    await page.getByText("没有匹配的记忆", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/loom-memory-${width}.png` });
    results.push({
      width,
      list: true,
      detail: true,
      bodySearch: true,
      edit: true,
      invalidateRestore: true,
      pin: true,
      delete: true,
      unknownExactReplay: true,
    });
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results));
