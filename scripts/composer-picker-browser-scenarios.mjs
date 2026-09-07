import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readyComposer } from "./composer-drop-browser-scenarios.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
async function choose(page, form, label, keyboard = false) {
  const button = form.getByRole("button", { name: label, exact: true });
  const waiting = page.waitForEvent("filechooser");
  if (keyboard) {
    await button.focus();
    await button.press("Enter");
  } else await button.click();
  const chooser = await waiting;
  assert.equal(chooser.isMultiple(), true);
  assert.equal(
    await chooser.element().getAttribute("accept"),
    label === "添加媒体" ? "image/*,video/*" : null,
  );
  return chooser;
}

export async function verifyComposerPickers({
  page,
  room,
  post,
  origin,
  output,
  engine,
  width,
  thread,
}) {
  const results = [];
  for (const target of ["thread", "chat"]) {
    if (target === "chat") await page.goto(origin + "/?room=" + room.roomId);
    const label = target === "chat" ? "消息输入框" : "Thread 回复输入框";
    const form = await readyComposer(page, label);
    const text = form.getByRole("textbox");
    const before = (await post("messages/list", { roomId: room.roomId }))
      .messages.length;
    await text.fill("draft preserved");
    await text.press("Home");
    await text.press("ArrowRight");
    const caret = await text.evaluate((el) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    // Empty selection models the browser file-input cancel boundary, not an OS dialog assertion.
    for (const name of ["添加媒体", "添加文件"]) {
      const chooser = await choose(page, form, name);
      assert.equal(
        await text.evaluate((el) => el === document.activeElement),
        true,
        "pointer open preserves composer focus",
      );
      await chooser.setFiles([]);
      assert.equal(await text.inputValue(), "draft preserved");
      assert.deepEqual(
        await text.evaluate((el) => [el.selectionStart, el.selectionEnd]),
        caret,
      );
      assert.equal(await form.locator(".rah-file-draft").count(), 0);
    }
    const media = {
      name: `${target}-picker.png`,
      mimeType: "image/png",
      buffer: png,
    };
    await (await choose(page, form, "添加媒体", true)).setFiles(media);
    await form.getByText("已上传", { exact: true }).waitFor();
    assert.equal(
      await form.getByLabel("选择媒体", { exact: true }).inputValue(),
      "",
    );
    await form
      .getByRole("button", { name: `移除附件 ${media.name}`, exact: true })
      .click();
    await (await choose(page, form, "添加媒体")).setFiles(media);
    await form.getByText("已上传", { exact: true }).waitFor();
    const files = [1, 2].map((n) => ({
      name: `${target}-picker-${n}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`picker bytes ${n}`),
    }));
    await (await choose(page, form, "添加文件")).setFiles(files);
    await page.waitForFunction((label) => {
      const t = [...document.querySelectorAll("textarea")].find(
        (e) => e.getAttribute("aria-label") === label,
      );
      return (
        [...t.closest("form").querySelectorAll(".rah-file-draft small")].filter(
          (e) => e.textContent === "已上传",
        ).length === 3
      );
    }, label);
    assert.equal(
      (await post("messages/list", { roomId: room.roomId })).messages.length,
      before,
      "selection never sends",
    );
    assert.equal(
      await form.getByLabel("选择附件", { exact: true }).inputValue(),
      "",
    );
    await page.screenshot({
      path: join(output, `${engine}-${target}-selected-${width}.png`),
    });
    const editorHeight = await text.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    assert.ok(
      editorHeight >= 40,
      `selected attachments must leave the editor usable: ${editorHeight}`,
    );
    await text.fill("");
    await page.mouse.move(0, 0);
    const geometry = await form
      .locator(".rah-composer-pickers")
      .evaluate((el) => ({
        gap: getComputedStyle(el).gap,
        buttons: [...el.querySelectorAll("button")].map((b) => {
          const s = getComputedStyle(b),
            r = b.getBoundingClientRect(),
            svg = b.querySelector("svg").getBoundingClientRect();
          return {
            width: r.width,
            height: r.height,
            padding: s.padding,
            border: s.borderTopWidth,
            icon: svg.width,
          };
        }),
      }));
    assert.equal(geometry.gap, "8px");
    for (const b of geometry.buttons)
      assert.deepEqual(b, {
        width: 26,
        height: 26,
        padding: "4px",
        border: "2px",
        icon: 14,
      });
    await page.screenshot({
      path: join(output, `${engine}-${target}-pickers-${width}.png`),
    });
    await text.press("Enter");
    await page.waitForFunction((label) => {
      const t = [...document.querySelectorAll("textarea")].find(
        (e) => e.getAttribute("aria-label") === label,
      );
      return (
        t && t.closest("form").querySelectorAll(".rah-file-draft").length === 0
      );
    }, label);
    const messages = (await post("messages/list", { roomId: room.roomId }))
      .messages;
    const message = messages.find((m) =>
      m.attachments?.some((a) => a.filename === media.name),
    );
    assert.ok(message, "canonical message includes the selected media");
    assert.equal(message.attachments.length, 3);
    assert.equal(
      message.threadId,
      target === "thread" ? thread.threadId : undefined,
    );
    await page.reload();
    const scope =
      target === "thread"
        ? page.getByRole("complementary", { name: "Thread 讨论" })
        : page.locator(".channel");
    for (const file of [media, ...files]) {
      const card = scope
        .locator(".rah-file-card")
        .filter({ has: page.getByText(file.name, { exact: true }) });
      await card
        .getByRole("button", { name: file.name + " 的操作", exact: true })
        .click();
      const waiting = page.waitForEvent("download");
      await page
        .getByRole("menuitem", { name: "下载文件", exact: true })
        .click();
      const d = await waiting;
      assert.equal(d.suggestedFilename(), file.name);
      assert.equal(await d.failure(), null);
      assert.deepEqual(await readFile(await d.path()), file.buffer);
    }
    results.push({
      target,
      geometry,
      messageId: message.messageId,
      status: "passed",
    });
  }
  return results;
}
