// FIXTURE ONLY: real Kernel, application service and gateway; fake native-copy and run adapters, no CLI/model.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createHumanApplicationPort } from "@rah-os/kernel";
import { ClientApplicationService } from "../../packages/application-service/src/index.ts";
import { LocalWorkbenchGateway } from "../../packages/daemon/src/local-workbench-gateway.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
} from "../../packages/kernel/test/role-instance-fixture.ts";
const results = [];
for (const width of [1440, 390]) {
  const f = roleInstanceFixture();
  let service, gateway, browser;
  let copies = 0,
    side;
  try {
    const offer = JSON.parse(
      f.db
        .prepare(
          "SELECT offer_json FROM runtime_offers WHERE runtime_offer_id='offer'",
        )
        .get().offer_json,
    );
    for (const key of [
      "acceptedAt",
      "resolvedCertifications",
      "runtimeOfferObservationId",
      "runtimeOfferSnapshotDigest",
    ])
      delete offer[key];
    f.kernel.publishRuntimeOffer(f.host, {
      ...offer,
      supportsAgentPrivateWorkspace: true,
      observedAt: new Date(Date.now() + 1).toISOString(),
    });
    const previous = JSON.parse(
      f.db
        .prepare(
          "SELECT definition_json FROM agent_definition_revisions WHERE agent_definition_revision_id=?",
        )
        .get(f.revisionId).definition_json,
    );
    f.kernel.reviseAgentDefinition(f.actor, {
      ...previous,
      agentId: f.agentId,
      executionWorkspace: { kind: "channel_home", roomId: f.home.roomId },
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "fixture-home-binding",
    });
    const run = startInstanceRun(f);
    f.kernel.instanceSessions.record(f.host, {
      runAttemptId: run.run.runAttemptId,
      runtimeRunId: run.runtime.runtimeRunId,
    });
    f.kernel.postWorkerMessage(run.execution, {
      body: "FIXTURE sender action entry",
      basedOnRoomSeq: run.scope.toSeq,
      idempotencyKey: "sender-action-message",
    });
    run.finish(0);
    service = new ClientApplicationService({
      human: createHumanApplicationPort(f.kernel),
      health: () => {
        throw Error("not used");
      },
      localRuntimeInventory: () => ({
        hostId: "host",
        restartRequiredToRescan: true,
        runtimes: [
          {
            runtimeOfferId: "offer",
            runtimeProfileId: "profile",
            available: true,
            configured: true,
            displayName: "FIXTURE COPY ONLY",
            executable: "fake",
            resolvedExecutablePath: "/fixture/fake",
            source: "configured",
            agentBindings: [],
            modelBindingDescriptors: [],
            sessionBranches: ["fork", "side"],
          },
        ],
      }),
      instanceFork: (actor, input) =>
        f.kernel.roles.forkInstance(actor, f.host, input, async () => {
          copies++;
        }),
      sideCreate: async (actor, input) => {
        const result = await f.kernel.roles.createSide(
          actor,
          f.host,
          input,
          async () => {
            copies++;
          },
        );
        side = result.side;
        return result;
      },
      sideDiscard: (actor, input) => f.kernel.roles.discardSide(actor, input),
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
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(12000);
    const openMenu = async () => {
      await page.getByTestId("loom-channel-control-trigger").click();
      await page.getByTestId("channel-overflow-members-entry").click();
      await page
        .getByTestId("member-page")
        .getByRole("button", { name: /^Reviewer-1/ })
        .click();
      await page.getByTestId("profile-panel").waitFor();
      await page.getByRole("button", { name: "更多操作 Reviewer-1" }).click();
    };
    await page.goto(gateway.origin + "/?room=" + f.home.roomId);
    const avatar = page
      .getByTestId("loom-message-timeline")
      .locator('[data-avatar-kind="agent"]')
      .first();
    await avatar.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "频道内私聊", exact: true })
      .click();
    await page
      .getByRole("button", { name: "关闭频道内私聊", exact: true })
      .waitFor();
    await page
      .getByRole("button", {
        name: width === 390 ? "返回频道" : "关闭频道内私聊",
        exact: true,
      })
      .click();
    await avatar.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Fork · 分叉为新成员", exact: true })
      .click();
    const forkDialog = page.locator(
      '[role="dialog"][data-slot="dialog-content"]',
    );
    await forkDialog
      .getByRole("button", { name: "创建 Fork", exact: true })
      .click();
    await forkDialog.waitFor({ state: "detached" });
    assert.equal(copies, 1);
    assert.equal(
      f.kernel.roles.list(f.actor, { controlRoomId: f.controlRoomId }).instances
        .length,
      2,
    );
    // Same sender menu, same branch owner; verify a lost Side response.
    await avatar.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Side · 打开独立侧聊", exact: true })
      .click();
    let first;
    await page.route("**/v3/client/sides/create", async (route) => {
      first = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await page.getByRole("button", { name: "创建 Side", exact: true }).click();
    await page.getByText("结果未知，不能重新创建。").waitFor();
    assert.equal(copies, 2);
    await page.unroute("**/v3/client/sides/create");
    const replay = page.waitForRequest((r) =>
      r.url().endsWith("/sides/create"),
    );
    await page.getByRole("button", { name: "核实分支结果" }).click();
    assert.deepEqual((await replay).postDataJSON(), first);
    const panel = page.getByTestId("side-panel");
    await panel.waitFor();
    if (width === 1440) {
      const closeStyle = await panel
        .getByRole("button", { name: "关闭 Side" })
        .evaluate((el) => ({
          border: getComputedStyle(el).borderTopColor,
          marker: el.getAttribute("data-loom-control"),
          width: el.getBoundingClientRect().width,
          icon: el.querySelector("svg")?.getAttribute("width"),
        }));
      assert.equal(
        closeStyle.border,
        "rgba(0, 0, 0, 0)",
        "native ghost close has no permanent ink border",
      );
      assert.equal(closeStyle.width, 32);
      assert.equal(closeStyle.icon, "16");
      assert.equal(closeStyle.marker, "detail-close");
    } else {
      assert.equal(
        await panel.getByTestId("thread-close").isVisible(),
        false,
        "native mobile uses back instead of X",
      );
      const back = panel.getByTestId("thread-mobile-back");
      const touch = await back.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          style = getComputedStyle(el),
          after = getComputedStyle(el, "::after");
        const target = document.elementFromPoint(r.x + 1, r.y + r.height / 2);
        return {
          width: r.width,
          expanded: parseFloat(after.width),
          expected:
            r.width -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth),
          left: after.left,
          right: after.right,
          owns: target === el || el.contains(target),
        };
      });
      assert.equal(touch.width, 44);
      assert.equal(touch.left, "0px");
      assert.equal(touch.right, "0px");
      assert.equal(
        touch.expanded,
        touch.expected,
        "native mobile action uses the padding box with zero extra inset",
      );
      assert.ok(touch.owns, "native mobile back owns its outer hit area");
    }
    assert.equal(copies, 2);
    assert.equal(
      f.kernel.roles.list(f.actor, { controlRoomId: f.controlRoomId }).instances
        .length,
      2,
    );
    await page.reload();
    await panel.waitFor();
    const sourceHead = f.head(f.home.roomId);
    const input = panel.getByTestId("composer-textarea");
    await input.fill("FIXTURE side question");
    const posted = page.waitForResponse(
      (r) => r.url().endsWith("/messages/post") && r.status() === 200,
    );
    await input.press("Enter");
    await posted;
    // Execute the accepted Side activation with a fake Host and an explicitly labelled fake reply.
    const sideRoom = f.kernel
      .listRooms(f.actor, { workspaceId: f.workspace.workspace.workspaceId })
      .find((r) => r.roomId === side.roomId);
    const sideRun = startInstanceRunFromQueue({
      ...f,
      instance: side,
      home: sideRoom,
    });
    assert.throws(() =>
      f.kernel.postWorkerMessage(sideRun.execution, {
        channel: f.home.roomId,
        body: "forbidden",
        basedOnRoomSeq: sourceHead,
        idempotencyKey: "forbidden",
      }),
    );
    f.kernel.postWorkerMessage(sideRun.execution, {
      body: "FIXTURE fake Side answer",
      basedOnRoomSeq: sideRun.scope.toSeq,
      idempotencyKey: "side-answer",
    });
    if (width === 1440) sideRun.finish(0);
    await panel
      .getByText("FIXTURE fake Side answer", { exact: true })
      .waitFor();
    assert.equal(f.head(f.home.roomId), sourceHead);
    if (width === 1440) {
      const before = await panel.boundingBox(),
        handle = await panel.getByTestId("side-resizer").boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
      await page.mouse.down();
      await page.mouse.move(handle.x - 50, handle.y + 200, { steps: 5 });
      await page.mouse.up();
      assert.ok(
        (await panel.boundingBox()).width > before.width + 30,
        "native side splitter changes width",
      );
      assert.ok(
        await page.getByTestId("loom-channel-control-trigger").isVisible(),
      );
    } else {
      assert.equal(
        await page.getByTestId("loom-channel-control-trigger").isVisible(),
        false,
      );
    }
    await page.screenshot({ path: `/tmp/loom-branches-${width}.png` });
    if (width === 390) await panel.getByTestId("thread-mobile-back").click();
    else await panel.getByRole("button", { name: "关闭 Side" }).click();
    await panel.waitFor({ state: "detached" });
    await openMenu();
    await page
      .getByRole("menuitem", { name: new RegExp("Side · .*side", "i") })
      .last()
      .click();
    await panel.waitFor();
    await panel
      .getByText("FIXTURE fake Side answer", { exact: true })
      .waitFor();
    await panel.getByRole("button", { name: "丢弃 Side", exact: true }).click();
    let discardedRequest;
    await page.route("**/v3/client/sides/discard", async (route) => {
      discardedRequest = route.request().postDataJSON();
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      await route.abort();
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "丢弃 Side", exact: true })
      .click();
    await page.getByText("丢弃结果未知。").waitFor();
    await page.waitForTimeout(3200);
    await page.unroute("**/v3/client/sides/discard");
    const discardReplay = page.waitForRequest((r) =>
      r.url().endsWith("/sides/discard"),
    );
    await page.getByRole("button", { name: "核实丢弃结果" }).click();
    assert.deepEqual((await discardReplay).postDataJSON(), discardedRequest);
    if (width === 390) {
      await panel
        .getByText("正在丢弃，等待执行退出。", { exact: true })
        .waitFor();
      assert.equal(
        await panel.locator('button[type="submit"]').isDisabled(),
        true,
      );
      let lateSends = 0;
      const count = (r) => {
        if (r.url().endsWith("/messages/post")) lateSends++;
      };
      page.on("request", count);
      await panel
        .getByTestId("composer-textarea")
        .fill("FIXTURE must not send after discard");
      await panel.getByTestId("composer-textarea").press("Enter");
      await page.waitForTimeout(250);
      page.off("request", count);
      assert.equal(lateSends, 0);
      assert.equal(f.kernel.roles.reconcileSideDiscards(), 0);
      f.kernel.recordRuntimeTermination(f.host, {
        runAttemptId: sideRun.run.runAttemptId,
        runtimeRunId: sideRun.runtime.runtimeRunId,
        exit: { code: null, signal: "SIGTERM" },
      });
      f.kernel.finishRunAttempt(f.host, {
        runAttemptId: sideRun.run.runAttemptId,
        state: "cancelled",
        exitSignal: "SIGTERM",
      });
      f.kernel.retryActivation(f.host, {
        activationId: sideRun.activation.activationId,
        error: "Side disabled",
        retryAfterMs: 1000,
      });
      assert.equal(f.kernel.roles.reconcileSideDiscards(), 1);
    }
    await panel.getByText("Side 已丢弃，历史只读。").waitFor();
    assert.equal(f.head(f.home.roomId), sourceHead);
    assert.deepEqual(errors, []);
    results.push({
      width,
      copies,
      fork: true,
      sideRoundTrip: true,
      refresh: true,
      reopen: true,
      sourceUnchanged: true,
      workerSourceWriteDenied: true,
      unknownCreateReplay: true,
      unknownDiscardReplay: true,
      busyDiscard: width === 390,
      nativeResponsive: true,
      resize: width === 1440,
    });
  } catch (error) {
    console.error(error);
    if (browser) {
      const p = browser.contexts()[0]?.pages()[0];
      if (p) console.error((await p.locator("body").innerText()).slice(-6000));
    }
    throw error;
  } finally {
    await browser?.close();
    await gateway?.stop();
    await service?.close();
    f.close();
  }
}
console.log(JSON.stringify(results));
