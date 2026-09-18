import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

process.env.RAH_FIXTURE_COMPOSER_FILES = "1";
process.env.RAH_FIXTURE_PRESENCE_PROBE = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const output = mkdtempSync(join(tmpdir(), "rah-composer-controls-"));
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    const post = async (path, data) => {
      const response = await page.request.post(
        `${fixture.origin}/v3/client/${path}`,
        { data, timeout: 45000 },
      );
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const seq = async (roomId) =>
      (await post("rooms/sos/read", { roomId })).latestRoomSeq;
    await context.addInitScript(() => {
      if (window === window.top)
        localStorage.setItem("rah:composer-files-mode:v1", "menu");
    });
    await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
    const composer = page.locator("main.channel form.composer");
    const editor = composer.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await expect(editor).toBeEnabled();
    const plus = composer.getByRole("button", {
      name: "添加引用或附件",
      exact: true,
    });
    await expect(plus).toHaveCount(1);
    const uploadButton = composer.getByRole("button", {
      name: "上传此设备的文件",
      exact: true,
    });
    await expect(uploadButton).toHaveCount(width === 390 ? 1 : 0);
    if (width === 390) {
      const choosing = page.waitForEvent("filechooser");
      await uploadButton.click();
      const chooser = await choosing;
      assert.equal(chooser.isMultiple(), true);
      assert.equal(await chooser.element().getAttribute("accept"), null);
      assert.equal(await chooser.element().getAttribute("capture"), null);
      await chooser.setFiles([]);
    }
    await editor.fill("Before after");
    await editor.evaluate((el) => el.setSelectionRange(7, 7));
    await plus.click();
    let dialog = page.getByRole("dialog", { name: "引用计算机文件或文件夹" });
    await expect(dialog.getByLabel("计算机", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("目录根", { exact: true })).toHaveCount(0);
    await expect(dialog.locator(".rah-computer-file-uploads")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "照片／拍照" }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "设备文件" })).toHaveCount(
      0,
    );
    const confirmReference = dialog.getByRole("button", {
      name: "引用所选",
      exact: true,
    });
    await expect(confirmReference).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "引用当前文件夹", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel("加号默认操作", { exact: true }),
    ).toHaveCount(0);
    await expect(dialog.locator(".rah-computer-file-row button")).toHaveCount(
      await dialog.locator(".rah-computer-file-row").count(),
    );
    await page.route("**/v3/client/computers/files/list", (route) => {
      if (route.request().postDataJSON().path !== "Folder with spaces")
        return route.continue();
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "forbidden", message: "FAKE directory access denied" },
        }),
      });
    });
    const folderButton = dialog.getByRole("button", {
      name: "打开文件夹 Folder with spaces",
      exact: true,
    });
    const folderBox = await folderButton.boundingBox();
    await page.mouse.move(
      folderBox.x + folderBox.width / 2,
      folderBox.y + folderBox.height / 2,
    );
    await page.mouse.down();
    await expect(folderButton).toHaveCSS(
      "background-color",
      "rgba(255, 212, 64, 0.3)",
    );
    await page.mouse.up();
    await expect(dialog.getByRole("alert")).toContainText(
      "FAKE directory access denied",
    );
    await dialog
      .getByRole("button", { name: "上一级目录", exact: true })
      .click();
    await page.unroute("**/v3/client/computers/files/list");
    await dialog
      .getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      })
      .click();
    await dialog.getByRole("button", { name: "note.txt", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "note.txt", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "note.txt", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "note.txt", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(confirmReference).toBeEnabled();
    await dialog
      .getByRole("button", { name: "返回用户主目录", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      })
      .click();
    await dialog.getByRole("button", { name: "note.txt", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "引用所选", exact: true }),
    ).toBeEnabled();
    assert.equal(
      await dialog
        .getByRole("button", { name: "引用所选", exact: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(254, 125, 168)",
    );
    assert.equal(
      await dialog
        .getByRole("button", { name: "note.txt", exact: true })
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(255, 212, 64, 0.3)",
    );
    const bounds = await dialog.boundingBox();
    assert.ok(
      Math.abs(bounds.y + bounds.height / 2 - (width === 390 ? 844 : 900) / 2) <
        2,
      "file dialog stays centered at both sizes",
    );
    await page.screenshot({
      path: join(output, `${width}-computer-files.png`),
    });
    const path = (
      await post("computers/files/list", { path: "Folder with spaces" })
    ).entries[0].absolutePath;
    await dialog.getByRole("button", { name: "引用所选", exact: true }).click();
    await expect(editor).toHaveValue(`Before @${JSON.stringify(path)} after`);
    await expect(editor).toBeFocused();
    await expect(composer.locator(".rah-file-draft")).toHaveCount(0);
    await plus.click();
    await dialog.getByRole("button", { name: "引用所选", exact: true }).click();
    assert.match(await editor.inputValue(), /reference-files"/);
    await plus.click();
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("menu", { name: "添加引用或附件" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    if (process.env.RAH_COMPOSER_FILES_ONLY === "1") {
      assert.deepEqual(errors, []);
      results.push({
        width,
        files: "path references; direct Plus and native mobile upload",
        errors,
      });
      await context.close();
      continue;
    }
    await editor.fill("");
    // Authenticated real daemon + fake child: stop must prove process termination.
    const members = (
      await post("rooms/agents/activity/list", { roomId: fixture.roomId })
    ).agents;
    const agentId = members?.[0]?.participantId;
    assert.ok(agentId, JSON.stringify(members));
    await post("messages/post", {
      roomId: fixture.roomId,
      body: "[presence-probe]",
      recipients: [{ participantId: agentId, reason: "mention" }],
      basedOnRoomSeq: await seq(fixture.roomId),
      idempotencyKey: crypto.randomUUID(),
    });
    const stop = composer.getByRole("button", {
      name: "停止当前对话的执行",
      exact: true,
    });
    await expect(stop).toBeEnabled({ timeout: 30000 });
    await page
      .locator("main.channel .msg")
      .filter({ hasText: "[presence-probe]" })
      .last()
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "打开消息列", exact: true })
      .click();
    const thread = page
      .getByRole("complementary", { name: "Thread 讨论", exact: true })
      .locator("form.composer");
    await expect(
      thread.getByRole("button", { name: "停止当前对话的执行", exact: true }),
    ).toBeEnabled();
    const reply = thread.getByRole("textbox");
    await reply.fill("FAKE editable thread correction");
    await expect(thread.locator('button[data-action="send"]')).toBeEnabled();
    await reply.fill("");
    await page
      .getByRole("button", {
        name: width === 390 ? "返回聊天" : "关闭消息列",
        exact: true,
      })
      .click();
    await editor.fill("correction stays editable while working");
    await expect(
      composer.getByRole("button", { name: "发送", exact: true }),
    ).toBeEnabled();
    await editor.fill("");
    await page.screenshot({ path: join(output, `${width}-stop.png`) });
    // First failure leaves the stop available and the draft intact.
    await page.route("**/v3/client/rooms/sos/stop", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "fixture_unavailable", message: "FAKE stop failure" },
        }),
      }),
    );
    await stop.click();
    await expect(composer.getByRole("alert")).toContainText(
      "FAKE stop failure",
    );
    await page.unroute("**/v3/client/rooms/sos/stop");
    await stop.click();
    await expect
      .poll(
        async () =>
          (await post("rooms/sos/read", { roomId: fixture.roomId })).operation
            ?.state,
        { timeout: 30000 },
      )
      .toBe("stopped");
    await expect(
      composer.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(editor).toBeEnabled();
    await expect(
      composer.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await editor.fill("FAKE corrected instruction");
    await composer.getByRole("button", { name: "发送", exact: true }).click();
    await expect(editor).toHaveValue("");
    await expect
      .poll(
        async () =>
          (await post("rooms/sos/read", { roomId: fixture.roomId })).operation,
      )
      .toBe(null);
    // Leave no long-lived fake execution behind before changing viewport.
    if ((await post("rooms/sos/read", { roomId: fixture.roomId })).working) {
      await post("rooms/sos/stop", {
        roomId: fixture.roomId,
        basedOnRoomSeq: await seq(fixture.roomId),
        idempotencyKey: crypto.randomUUID(),
        resumeOnMessage: true,
      });
    }
    await page.goto(fixture.origin);
    await page
      .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
      .first()
      .click();
    await expect(page.locator(".rah-direct-title")).toBeVisible();
    await expect(editor).toBeEnabled();
    await plus.click();
    await expect(
      dialog.getByRole("button", { name: "引用所选", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "引用所选", exact: true }).click();
    assert.match(await editor.inputValue(), /reference-files"/);
    await expect(editor).toBeFocused();
    await editor.fill("[presence-probe]");
    await expect(editor).toHaveValue("[presence-probe]");
    await composer.getByRole("button", { name: "发送", exact: true }).click();
    await expect(stop).toBeEnabled({ timeout: 30000 });
    await page.screenshot({ path: join(output, `${width}-dm-stop.png`) });
    await stop.click();
    await expect(
      composer.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled({ timeout: 30000 });
    assert.deepEqual(errors, []);
    results.push({
      width,
      files: "path only, no upload",
      stop: "terminal proven, failure/reload/correction",
      errors,
    });
    await context.close();
  }
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page
        .screenshot({ path: join(output, "failure.png") })
        .catch(() => {});
      console.error((await page.locator("body").innerText()).slice(-4000));
    }
  throw error;
} finally {
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify({ results }, null, 2),
  );
  console.log(output);
  await browser.close();
  await fixture.close();
}
