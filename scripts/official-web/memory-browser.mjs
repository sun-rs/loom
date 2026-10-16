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
    await page.getByRole("button", { name: "修订历史", exact: true }).click();
    await page.getByRole("button", { name: "查看修订 1", exact: true }).click();
    await page
      .getByTestId("memory-history")
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "修订历史", exact: true }).click();
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
    await page.getByRole("textbox", { name: "搜索记忆" }).fill("");
    await page.getByRole("combobox", { name: "状态", exact: true }).click();
    await page.getByRole("option", { name: "已删除", exact: true }).click();
    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page.getByRole("button", { name: "修订历史", exact: true }).click();
    await page.getByRole("button", { name: "查看修订 1", exact: true }).click();
    await page
      .getByTestId("memory-history")
      .getByText("正文已删除", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("FIXTURE body searchable unicorn", { exact: true })
        .count(),
      0,
    );
    await page.goto(gateway.origin + "/?room=" + f.home.roomId);
    const openPolicy = async () => {
      await page.getByTestId("loom-channel-control-trigger").click();
      await page
        .getByRole("button", { name: "频道记忆权限", exact: true })
        .click();
      await page
        .getByRole("switch", { name: "默认读取", exact: true })
        .waitFor();
    };
    await openPolicy();
    const policyDialog = page.getByRole("dialog", {
      name: "频道记忆权限",
      exact: true,
    });
    await policyDialog
      .getByRole("switch", { name: "默认读取", exact: true })
      .click();
    await policyDialog
      .getByRole("switch", { name: "默认写入", exact: true })
      .click();
    await policyDialog
      .getByRole("combobox", { name: "Reviewer-1 读取", exact: true })
      .click();
    await page.getByRole("option", { name: "允许", exact: true }).click();
    await page.screenshot({ path: `/tmp/loom-memory-policy-${width}.png` });
    let policyInput;
    await page.route("**/v3/client/memory/policy/update", async (route) => {
      policyInput = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await policyDialog
      .getByRole("button", { name: "保存权限", exact: true })
      .click();
    await policyDialog.getByText(/保存结果未知/).waitFor();
    await page.unroute("**/v3/client/memory/policy/update");
    const policyReplay = page.waitForRequest((r) =>
      r.url().endsWith("/memory/policy/update"),
    );
    await policyDialog.getByRole("button", { name: "核实原操作" }).click();
    assert.deepEqual((await policyReplay).postDataJSON(), policyInput);
    await policyDialog.waitFor({ state: "detached" });
    let policy = f.kernel.memory.readPolicy(f.actor, {
      channelId: f.home.roomId,
    });
    assert.equal(policy.readDefault, false);
    assert.equal(policy.writeDefault, false);
    assert.equal(policy.members[0].read, true);
    assert.equal(policy.members[0].write, false);
    await openPolicy();
    assert.equal(
      await policyDialog
        .getByRole("switch", { name: "默认读取", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await policyDialog
      .getByRole("combobox", { name: "Reviewer-1 读取", exact: true })
      .click();
    await page.getByRole("option", { name: "跟随频道", exact: true }).click();
    await policyDialog
      .getByRole("button", { name: "保存权限", exact: true })
      .click();
    await policyDialog.waitFor({ state: "detached" });
    policy = f.kernel.memory.readPolicy(f.actor, { channelId: f.home.roomId });
    assert.equal(policy.members[0].read, false);
    assert.equal(policy.overrides.length, 0);
    await openPolicy();
    await policyDialog
      .getByRole("switch", { name: "默认读取", exact: true })
      .click();
    f.kernel.memory.updatePolicy(f.actor, {
      channelId: f.home.roomId,
      expectedRevision: policy.revision,
      writeDefault: true,
      idempotencyKey: "external-policy-change",
    });
    await policyDialog
      .getByRole("button", { name: "保存权限", exact: true })
      .click();
    await policyDialog.getByText(/保存未完成/).waitFor();
    assert.equal(
      f.kernel.memory.readPolicy(f.actor, { channelId: f.home.roomId })
        .revision,
      policy.revision + 1,
    );
    await policyDialog
      .getByRole("button", { name: "重新读取权限", exact: true })
      .click();
    await policyDialog
      .locator('[role="switch"][aria-label="默认读取"][aria-checked="false"]')
      .waitFor();
    await policyDialog
      .getByRole("switch", { name: "默认读取", exact: true })
      .waitFor();
    assert.equal(
      await policyDialog
        .getByRole("switch", { name: "默认读取", exact: true })
        .getAttribute("aria-checked"),
      "false",
    );
    await policyDialog
      .getByRole("button", { name: "关闭记忆权限", exact: true })
      .click();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/loom-memory-${width}.png` });
    results.push({
      width,
      list: true,
      history: true,
      deletedHistoryRedacted: true,
      policyDefaultsOverrideInherit: true,
      policyUnknownReplay: true,
      policyConflictReread: true,
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
