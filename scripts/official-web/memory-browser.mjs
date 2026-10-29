// FIXTURE: real Kernel/application service, fake Worker identity; no paid CLI.
import assert from "node:assert/strict";
import { assertDialogActionOrder } from "./dialog-action-browser.mjs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
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
    const longBody = Array.from(
      { length: 30 },
      (_, i) => `FIXTURE long memory line ${i + 1}`,
    ).join("\n");
    f.kernel.memory.write(work.execution, {
      name: "fixture-long-memory",
      type: "project",
      description: "FIXTURE 长记忆简介",
      body: longBody,
      idempotencyKey: "fixture-long-memory",
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
    browser = await (
      process.env.LOOM_BROWSER_ENGINE === "webkit" ? webkit : chromium
    ).launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      isMobile: width === 390,
      hasTouch: width === 390,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const memoryAction = async (name) => {
      if (width === 1440)
        await page
          .getByTestId("memory-detail")
          .getByRole("button", { name, exact: true })
          .click();
      else {
        await page
          .getByTestId("memory-detail")
          .getByRole("button", { name: "记忆操作", exact: true })
          .click();
        await page.getByRole("menuitem", { name, exact: true }).click();
      }
    };
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(gateway.origin + "/?view=memory");
    const toolbar = page.getByTestId("memory-toolbar");
    await toolbar.waitFor();
    if (process.env.LOOM_MEMORY_DIALOG_ORDER_ONLY === "1") {
      await page
        .getByRole("button", { name: "fixture-memory", exact: true })
        .click();
      await memoryAction("编辑");
      const dialog = page.getByRole("dialog", {
        name: "编辑记忆",
        exact: true,
      });
      await dialog.waitFor();
      await assertDialogActionOrder({
        page,
        dialog,
        width,
        saveName: "保存记忆",
        screenshot: `/tmp/loom-memory-dialog-order-${width}.png`,
      });
      await dialog
        .getByRole("button", {
          name: width === 390 ? "关闭" : "取消",
          exact: true,
        })
        .click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        modalActionOrder: true,
        nativeAdaptiveLayout: true,
        cancelCloses: true,
      });
      continue;
    }
    const geometry = await Promise.all(
      [
        page.getByRole("textbox", { name: "搜索记忆" }),
        page.getByRole("combobox", { name: "频道", exact: true }),
        page.getByRole("combobox", { name: "状态", exact: true }),
      ].map(async (locator) => locator.boundingBox()),
    );
    assert.ok(
      geometry.every(
        (r) => Math.abs(r.y - geometry[0].y) < 2 && r.height === 32,
      ),
      "single compact toolbar row",
    );

    const card = page.getByRole("button", {
      name: "fixture-memory",
      exact: true,
    });
    await card.waitFor();
    await card
      .getByTestId("memory-card-metadata")
      .locator("[data-slot=badge]")
      .first()
      .waitFor();
    await card
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    const listWidth = (await page.getByTestId("loom-memory-list").boundingBox())
      .width;
    assert.ok(listWidth > width * 0.7, "closed detail uses wide card list");
    const longCard = page.getByRole("button", {
      name: "fixture-long-memory",
      exact: true,
    });
    await longCard.getByText("查看全文", { exact: true }).waitFor();
    const preview = await longCard
      .getByTestId("memory-card-body")
      .evaluate((el) => ({
        height: el.clientHeight,
        full: el.scrollHeight,
        line: parseFloat(getComputedStyle(el).lineHeight),
      }));
    assert.ok(
      preview.full > preview.height && preview.height <= preview.line * 6 + 1,
      "long body is capped at six lines",
    );
    await page.screenshot({ path: `/tmp/loom-memory-cards-${width}.png` });
    await longCard.click();
    await page
      .getByTestId("memory-detail")
      .getByText(longBody, { exact: true })
      .waitFor();
    if (width === 1440) {
      assert.ok(
        (await page.getByTestId("loom-memory-list").boundingBox()).width <
          listWidth,
      );
      const border = await page.getByTestId("memory-master").evaluate((el) => ({
        width: getComputedStyle(el).borderRightWidth,
        color: getComputedStyle(el).borderRightColor,
        expected: (() => {
          const probe = document.createElement("div");
          probe.className = "border-r border-line-seam";
          el.appendChild(probe);
          const value = getComputedStyle(probe).borderRightColor;
          probe.remove();
          return value;
        })(),
      }));
      assert.equal(border.width, "1px");
      assert.equal(
        border.color,
        border.expected,
        "native seam token owns the divider",
      );
      const actionBorder = await page
        .getByTestId("memory-detail")
        .getByRole("button", { name: "编辑", exact: true })
        .evaluate((el) => getComputedStyle(el).borderTopWidth);
      assert.ok(
        parseFloat(actionBorder) > 0,
        "native outline actions have visible borders",
      );
    } else
      assert.equal(
        await page.getByTestId("loom-memory-list").isVisible(),
        false,
      );
    const closeStyle = await page
      .getByRole("button", { name: "关闭记忆正文", exact: true })
      .evaluate((el) => ({
        color: getComputedStyle(el).borderTopColor,
        width: el.getBoundingClientRect().width,
      }));
    assert.equal(closeStyle.width, 32, "rUI 0.6 native icon size");
    if (width === 390) {
      const close = page.getByRole("button", {
        name: "关闭记忆正文",
        exact: true,
      });
      const hit = await close.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          style = getComputedStyle(el, "::after");
        return {
          x: r.left - 4,
          y: r.top + r.height / 2,
          width: style.width,
          nativeWidth: el.clientWidth + 12,
          nativeHeight: el.clientHeight + 12,
          height: style.height,
          owns:
            document
              .elementFromPoint(r.left - 4, r.top + r.height / 2)
              ?.closest("button") === el,
        };
      });
      assert.equal(hit.width, hit.nativeWidth + "px");
      assert.equal(hit.height, hit.nativeHeight + "px");
      assert.ok(hit.owns, "outer touch area targets the close button");
      await page.mouse.click(hit.x, hit.y);
    } else
      await page
        .getByRole("button", { name: "关闭记忆正文", exact: true })
        .click();
    await page.getByTestId("memory-detail").waitFor({ state: "detached" });
    await longCard.waitFor();
    assert.equal(
      (await page.getByTestId("loom-memory-list").boundingBox()).width,
      listWidth,
    );
    if (process.env.LOOM_MEMORY_LAYOUT_ONLY === "1") {
      results.push({
        width,
        layout: true,
        sixLinePreview: true,
        detailReturn: true,
        closeTouchTarget: width === 390,
      });
      continue;
    }
    if (width === 1440) {
      await card.click({ button: "right" });
      await page.getByRole("menuitem", { name: "编辑", exact: true }).waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("memory"),
        null,
        "right click does not navigate",
      );
      await page.keyboard.press("Escape");
      // A card mutation must retain unknown-result recovery without opening detail.
      let pinInput;
      await page.route("**/v3/client/memory/pin", async (route) => {
        pinInput = route.request().postDataJSON();
        await route.fetch();
        await route.abort("failed");
      });
      await longCard.click({ button: "right" });
      await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
      await page
        .getByRole("button", { name: "核实原操作", exact: true })
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.get("memory"), null);
      await page.unroute("**/v3/client/memory/pin");
      const replay = page.waitForRequest((r) =>
        r.url().endsWith("/memory/pin"),
      );
      await page
        .getByRole("button", { name: "核实原操作", exact: true })
        .click();
      assert.deepEqual((await replay).postDataJSON(), pinInput);
      await page
        .getByRole("button", { name: "核实原操作", exact: true })
        .waitFor({ state: "hidden" });
      await card.waitFor();
    }

    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page
      .getByTestId("memory-detail")
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get("memory"),
      written.entryId,
    );
    await page.reload();
    await page
      .getByTestId("memory-detail")
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    await page.goBack();
    assert.equal(new URL(page.url()).searchParams.get("memory"), null);
    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page
      .getByTestId("memory-detail")
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "修订历史", exact: true }).click();
    await page.getByRole("button", { name: "查看修订 1", exact: true }).click();
    await page
      .getByTestId("memory-history")
      .getByText("FIXTURE body searchable unicorn", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "修订历史", exact: true }).click();
    await memoryAction("编辑");
    const edit = page.getByRole("dialog");
    await edit
      .getByRole("textbox", { name: "记忆正文" })
      .fill("FIXTURE edited searchable unicorn");
    await edit
      .getByRole("textbox", { name: "简介", exact: true })
      .fill("FIXTURE edited description");
    await page.goBack();
    const historyConfirm = page.getByRole("alertdialog");
    await historyConfirm.waitFor();
    await historyConfirm
      .getByRole("button", { name: "继续编辑", exact: true })
      .click();
    await historyConfirm.waitFor({ state: "hidden" });
    assert.equal(
      new URL(page.url()).searchParams.get("memory"),
      written.entryId,
    );
    await page.keyboard.press("Escape");
    const discard = page.getByRole("alertdialog");
    await discard.waitFor();
    await discard
      .getByRole("button", { name: "继续编辑", exact: true })
      .click();
    assert.equal(
      await edit
        .getByRole("textbox", { name: "简介", exact: true })
        .inputValue(),
      "FIXTURE edited description",
    );
    assert.equal(
      new URL(page.url()).searchParams.get("memory"),
      written.entryId,
    );
    if (width === 390)
      assert.equal(
        await page.locator('[data-slot="mobile-nav-root"]').count(),
        0,
      );
    let editInput;
    await page.route("**/v3/client/memory/update", async (route) => {
      editInput = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    const saveAction = edit.getByRole("button", {
      name: "保存记忆",
      exact: true,
    });
    assert.equal(await saveAction.getAttribute("data-loom-action"), "formSave");
    assert.equal((await saveAction.boundingBox()).height, 32);
    assert.equal(
      await saveAction.evaluate((el) => getComputedStyle(el).fontSize),
      await saveAction.evaluate((el) =>
        getComputedStyle(el).getPropertyValue("--text-control").trim(),
      ),
    );
    await saveAction.click();
    await edit.getByText(/保存结果未知/).waitFor();
    await page.goBack();
    await edit.getByText(/保存结果未知/).waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get("memory"),
      written.entryId,
    );
    assert.equal(
      await page.getByRole("alertdialog").count(),
      0,
      "unknown write cannot offer draft discard",
    );
    await page.unroute("**/v3/client/memory/update");
    const editReplay = page.waitForRequest((r) =>
      r.url().endsWith("/memory/update"),
    );
    await edit.getByRole("button", { name: "核实原操作" }).click();
    assert.deepEqual((await editReplay).postDataJSON(), editInput);
    await edit.waitFor({ state: "detached" });
    await page
      .getByTestId("memory-detail")
      .getByText("FIXTURE edited searchable unicorn", { exact: true })
      .waitFor();
    await memoryAction("置顶");
    await page.getByText(/修订 3/).waitFor();
    if (width === 1440)
      await card
        .getByText("FIXTURE edited searchable unicorn", { exact: true })
        .waitFor();
    await page.screenshot({ path: `/tmp/loom-memory-detail-${width}.png` });
    await memoryAction("标为失效");
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "原因" })
      .fill("FIXTURE invalidation");
    await page.getByRole("button", { name: "确认失效", exact: true }).click();
    await page.getByText(/修订 4/).waitFor();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await memoryAction("恢复");
    await page.getByText(/修订 5/).waitFor();
    if (width === 390)
      await page.getByRole("button", { name: "记忆列表", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索记忆" }).fill("unicorn");
    await page
      .getByRole("button", { name: "fixture-memory", exact: true })
      .click();
    await page
      .getByTestId("memory-detail")
      .getByText("FIXTURE edited searchable unicorn", { exact: true })
      .waitFor();
    await memoryAction("删除");
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
