import { openChannelWithHistory } from "./mobile-chat-browser.mjs";
import assert from "node:assert/strict";
export async function verifyChannelTasks({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const room = (
      await client.request("room.create", {
        workspaceId: workspace.workspaceId,
        kind: "channel",
        name: `FIXTURE task entry ${width}`,
        slug: `fixture-task-entry-${width}`,
        basedOnControlRoomSeq: await head(workspace.controlRoomId),
        idempotencyKey: `task-entry-room-${width}`,
      })
    ).room;
    await client.request("message.post", {
      roomId: room.roomId,
      body: `FIXTURE convert ${width}`,
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `convert-root-${width}`,
    });
    const root = (
      await client.request("message.list", { roomId: room.roomId, limit: 50 })
    ).messages[0];
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage(),
        errors = [],
        external = [],
        creates = [],
        converts = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      for (const [op, calls] of [
        ["create", creates],
        ["convert", converts],
      ])
        await page.route(`**/v3/client/tasks/${op}`, async (route) => {
          calls.push(route.request().postDataJSON());
          if (calls.length === 1) {
            await route.fetch();
            await route.abort();
          } else await route.continue();
        });
      await openChannelWithHistory(page, origin, room.roomId);
      const composer = page.getByTestId("chat-composer-shell"),
        toggle = composer.getByTestId("composer-as-task-toggle"),
        textarea = composer.locator("textarea");
      await textarea.focus();
      await toggle.waitFor();
      await toggle.click();
      await textarea.fill(`FIXTURE created ${width}`);
      await textarea.press("Enter");
      const verify = page.getByRole("button", {
        name: "核实发送",
        exact: true,
      });
      await verify.waitFor();
      assert.equal(creates.length, 1);
      const original = page.url();
      await page.goBack();
      await page.waitForURL(original);
      await verify.click();
      await verify.waitFor({ state: "detached" });
      assert.equal(creates.length, 2);
      assert.deepEqual(creates[0], creates[1]);
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="composer-as-task-toggle"]')
            ?.getAttribute("aria-checked") === "false",
      );
      const tasks = (
        await client.request("task.list", { roomId: room.roomId, limit: 50 })
      ).tasks;
      assert.equal(tasks.length, 1);
      const created = tasks[0];
      assert.equal(created.title, `FIXTURE created ${width}`);
      const messages = (
        await client.request("message.list", { roomId: room.roomId, limit: 50 })
      ).messages;
      assert.equal(messages.filter((m) => m.body === created.title).length, 1);
      const badge = page
        .locator(`#message-${created.sourceMessageId}`)
        .getByTestId("message-task-badge");
      await badge.waitFor();
      await badge.click();
      const modal = page.getByTestId("task-thread-modal");
      await modal.getByTestId("task-modal-title").waitFor();
      assert.equal(
        await modal.getByTestId("task-modal-title").innerText(),
        created.title,
      );
      await page.reload();
      await modal.getByTestId("task-modal-title").waitFor();
      await modal
        .getByTestId(
          width === 390 ? "task-modal-mobile-back" : "task-modal-close",
        )
        .click();
      await modal.waitFor({ state: "detached" });
      const row = page.locator(`#message-${root.messageId}`);
      await row.scrollIntoViewIfNeeded();
      if (width === 390) {
        const box = await row.boundingBox();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + 3, y: box.y + 3 }],
        });
        await page.getByRole("menu").waitFor();
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else await row.click({ button: "right" });
      const menu = page.getByRole("menu");
      await menu.waitFor();
      assert.equal(
        await menu.getByText(/^(转为任务|Convert to Task)$/).count(),
        1,
        await menu.innerText(),
      );
      await menu.getByText(/^(转为任务|Convert to Task)$/).click();
      await verify.waitFor();
      assert.equal(converts.length, 1);
      await verify.click();
      await verify.waitFor({ state: "detached" });
      assert.equal(converts.length, 2);
      assert.deepEqual(converts[0], converts[1]);
      await row.getByTestId("message-task-badge").waitFor();
      const all = (
        await client.request("task.list", { roomId: room.roomId, limit: 50 })
      ).tasks;
      assert.equal(all.length, 2);
      assert.equal(
        all.filter((t) => t.sourceMessageId === root.messageId).length,
        1,
      );
      assert.equal(
        (
          await client.request("message.list", {
            roomId: room.roomId,
            limit: 50,
          })
        ).messages.length,
        2,
      );
      await row.click({ button: "right" });
      await menu.getByText("打开任务", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      await textarea.fill(`FIXTURE ordinary ${width}`);
      await textarea.press("Enter");
      await page
        .getByText(`FIXTURE ordinary ${width}`, { exact: true })
        .waitFor();
      assert.equal(
        (await client.request("task.list", { roomId: room.roomId, limit: 50 }))
          .tasks.length,
        2,
      );
      await page.route("**/v3/client/tasks/global", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "forbidden",
              message: "FIXTURE task projection denied",
            },
          }),
        }),
      );
      await row
        .getByTestId("message-task-badge")
        .waitFor({ state: "detached" });
      await row.click({ button: "right" });
      assert.equal(
        await menu
          .getByRole("menuitem", { name: /^(转为任务|Convert to Task)$/ })
          .isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      await page.unroute("**/v3/client/tasks/global");
      await row.getByTestId("message-task-badge").waitFor();
      await page.screenshot({
        path: `/tmp/loom-channel-task-${width}.png`,
        animations: "disabled",
      });
      await page.goto(
        `${origin}/?room=${room.roomId}&view=tasks&task=${created.taskId}&taskChannel=${room.roomId}`,
      );
      await page.getByTestId("task-modal-title").first().waitFor();
      assert.equal(
        await page.getByTestId("task-thread-modal").count(),
        1,
        "hidden channel must not mount a second task modal",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        nativeComposerTask: true,
        atomicCreate: true,
        exactUnknownReplay: true,
        routeGuard: true,
        nativeContextMenu: true,
        touchLongPress: width === 390,
        convertPreservesMessageIdentity: true,
        taskBadgeAndReload: true,
        escapeDismiss: true,
        ordinarySendUnchanged: true,
        taskReadDenialAndRecovery: true,
        singleModalAcrossDestinations: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
