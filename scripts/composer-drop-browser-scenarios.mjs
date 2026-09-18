import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function fileTransfer(
  page,
  name = "extra.txt",
  content = "extra content",
) {
  return page.evaluateHandle(
    ({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: "text/plain" }));
      return dt;
    },
    { name, content },
  );
}
export async function readyComposer(page, label) {
  const form = page
    .locator("form.composer")
    .filter({ has: page.getByRole("textbox", { name: label, exact: true }) });
  await form
    .getByRole("button", { name: "添加引用或附件", exact: true })
    .waitFor();
  await page.waitForFunction((label) => {
    const t = [...document.querySelectorAll("textarea")].find(
      (e) => e.getAttribute("aria-label") === label,
    );
    const b = t?.closest("form")?.querySelector('input[aria-label="选择附件"]');
    return b && !b.disabled;
  }, label);
  return form;
}
export async function verifyDropEdges({
  page,
  form,
  room,
  post,
  origin,
  output,
  engine,
  width,
}) {
  const dt = await fileTransfer(page),
    overlay = form.locator('[data-testid="composer-drop-overlay"]');
  await form.dispatchEvent("dragenter", { dataTransfer: dt });
  await overlay.waitFor({ state: "visible" });
  await form
    .getByRole("textbox")
    .dispatchEvent("dragenter", { dataTransfer: dt });
  await form
    .getByRole("textbox")
    .dispatchEvent("dragleave", { dataTransfer: dt });
  assert.equal(
    await overlay.count(),
    1,
    "nested exit does not clear parent drag",
  );
  const geometry = await overlay.evaluate((el) => {
    const s = getComputedStyle(el),
      label = getComputedStyle(el.firstElementChild),
      a = el.getBoundingClientRect(),
      b = el.closest("form").getBoundingClientRect();
    return {
      border: s.borderTopWidth,
      style: s.borderTopStyle,
      z: s.zIndex,
      background: s.backgroundColor,
      label: {
        font: label.fontSize,
        color: label.color,
        borderColor: label.borderTopColor,
        weight: label.fontWeight,
        padding: label.padding,
        lineHeight: label.lineHeight,
        shadow: label.boxShadow,
      },
      inside:
        a.x >= b.x && a.right <= b.right && a.y >= b.y && a.bottom <= b.bottom,
    };
  });
  assert.equal(geometry.border, "2px");
  assert.equal(geometry.style, "dashed");
  assert.equal(geometry.z, "30");
  assert.equal(geometry.inside, true);
  assert.equal(geometry.label.font, "14px");
  assert.equal(geometry.label.color, "rgb(0, 0, 0)");
  assert.equal(geometry.label.borderColor, "rgb(0, 0, 0)");
  assert.equal(geometry.label.weight, "700");
  assert.equal(geometry.label.padding, "6px 12px");
  await page.keyboard.press("Escape");
  assert.equal(await overlay.count(), 0);
  await form.dispatchEvent("dragenter", { dataTransfer: dt });
  await form.dispatchEvent("dragleave", { dataTransfer: dt });
  assert.equal(await overlay.count(), 0);
  const text = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.setData("text/plain", "normal text");
    return d;
  });
  assert.equal(
    await form.evaluate(
      (el, d) =>
        el.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: d,
          }),
        ),
      text,
    ),
    true,
    "text drops retain native handling",
  );
  await text.dispose();
  // Directory entries are browser-provided objects; inject just that native boundary.
  await form.evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File([""], "folder"));
    Object.defineProperty(dt, "items", {
      value: [
        {
          kind: "file",
          webkitGetAsEntry: () => ({ isDirectory: true }),
          getAsFile: () => null,
        },
      ],
    });
    el.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      }),
    );
  });
  await form.getByRole("alert").filter({ hasText: "无法上传文件夹" }).waitFor();
  assert.equal(await form.locator(".rah-file-draft").count(), 0);
  // Current task mode denies drop, including direct file-picker change events.
  const task = form.getByRole("checkbox");
  if (await task.count()) {
    await form.locator("label.task-check").click();
    assert.equal(await task.isChecked(), true);
    await form.dispatchEvent("dragenter", { dataTransfer: dt });
    assert.equal(await overlay.count(), 0);
    await form.dispatchEvent("drop", { dataTransfer: dt });
    await form.getByLabel("选择附件", { exact: true }).setInputFiles({
      name: "denied.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("denied"),
    });
    assert.equal(await form.locator(".rah-file-draft").count(), 0);
    await form.locator("label.task-check").click();
    assert.equal(await task.isChecked(), false);
  }
  // Real upload endpoint failure leaves an unsendable row, removable and retryable.
  await page.route("**/v3/client/files/content/*", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "FixtureUploadFailure",
            message: "fixture upload unavailable",
          },
        }),
      });
    else await route.continue();
  });
  await form.dispatchEvent("drop", { dataTransfer: dt });
  await form.getByText("fixture upload unavailable", { exact: true }).waitFor();
  assert.equal(await form.locator("button[type=submit]").isDisabled(), true);
  await form
    .getByRole("button", { name: "移除附件 extra.txt", exact: true })
    .click();
  await page.unroute("**/v3/client/files/content/*");
  await form.dispatchEvent("drop", { dataTransfer: dt });
  await form.getByText("已上传", { exact: true }).waitFor();
  await form
    .getByRole("button", { name: "移除附件 extra.txt", exact: true })
    .click();
  assert.equal(await form.locator(".rah-file-draft").count(), 0);
  // No messages were made by any of the edge interactions.
  assert.equal(
    (await post("messages/list", { roomId: room.roomId })).messages.length,
    1,
  );
  await page.screenshot({
    path: join(output, `${engine}-drop-recovery-${width}.png`),
  });
  await dt.dispose();
  return geometry;
}
export async function downloadExact(page, scope, filename, expected) {
  const card = scope
    .locator(".rah-file-card")
    .filter({ has: page.getByText(filename, { exact: true }) });
  await card
    .getByRole("button", { name: `预览 ${filename}`, exact: true })
    .click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  const d = await waiting;
  assert.equal(d.suggestedFilename(), filename);
  assert.equal(await d.failure(), null);
  assert.equal(await readFile(await d.path(), "utf8"), expected);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
}
export async function verifyThreadDrop({
  page,
  room,
  post,
  origin,
  output,
  engine,
  width,
}) {
  const root = page
    .locator(".msg")
    .filter({ has: page.locator(".rah-message-files") })
    .first();
  await root.click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开消息列", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Thread 讨论" });
  const form = await readyComposer(page, "Thread 回复输入框");
  const dt = await fileTransfer(page, "thread-drop.txt", "thread exact bytes");
  await form.dispatchEvent("dragenter", { dataTransfer: dt });
  await form.locator('[data-testid="composer-drop-overlay"]').waitFor();
  await page.screenshot({
    path: join(output, `${engine}-thread-drop-${width}.png`),
  });
  await form.dispatchEvent("drop", { dataTransfer: dt });
  await form.getByText("已上传", { exact: true }).waitFor();
  // Room and Thread draft queues are distinct even within one Room.
  const chat = page.locator("form.composer").filter({
    has: page.getByRole("textbox", { name: "消息输入框", exact: true }),
  });
  assert.equal(await chat.locator(".rah-file-draft").count(), 0);
  const before = (await post("messages/list", { roomId: room.roomId })).messages
    .length;
  await form.getByRole("textbox").press("Enter");
  await panel
    .locator(".rah-message-files")
    .getByText("thread-drop.txt", { exact: true })
    .waitFor();
  const threads = (await post("threads/list", { roomId: room.roomId })).threads;
  assert.equal(threads.length, 1);
  const replies = (
    await post("messages/list", {
      roomId: room.roomId,
      threadId: threads[0].threadId,
    })
  ).messages;
  assert.equal(replies.length, 1);
  assert.equal(replies[0].attachments.length, 1);
  assert.equal(
    (await post("messages/list", { roomId: room.roomId })).messages.filter(
      (m) => m.threadId === undefined,
    ).length,
    before,
    "Thread attachment does not become a top-level message",
  );
  await page.reload();
  await panel
    .locator(".rah-message-files")
    .getByText("thread-drop.txt", { exact: true })
    .waitFor();
  await downloadExact(page, panel, "thread-drop.txt", "thread exact bytes");
  // A slow upload belongs to the original Thread draft after closing/reopening.
  let releaseUpload, sawUpload;
  const held = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  const started = new Promise((resolve) => {
    sawUpload = resolve;
  });
  await page.route("**/v3/client/files/content/*", async (route) => {
    if (route.request().method() === "PUT") {
      sawUpload();
      await held;
    }
    await route.continue();
  });
  const late = await fileTransfer(page, "late-thread.txt", "late bytes");
  try {
    const again = await readyComposer(page, "Thread 回复输入框");
    await again.dispatchEvent("drop", { dataTransfer: late });
    await started;
    await again.getByText("上传中…", { exact: true }).waitFor();
    assert.equal(await again.locator("button[type=submit]").isDisabled(), true);
    await panel
      .getByRole("button", {
        name: width <= 767 ? "返回聊天" : "关闭消息列",
        exact: true,
      })
      .click();
    await panel.waitFor({ state: "detached" });
    assert.equal(await chat.locator(".rah-file-draft").count(), 0);
    releaseUpload();
    await root.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "打开消息列", exact: true })
      .click();
    const restored = await readyComposer(page, "Thread 回复输入框");
    await restored.getByText("已上传", { exact: true }).waitFor();
    assert.equal(await chat.locator(".rah-file-draft").count(), 0);
    await restored
      .getByRole("button", { name: "移除附件 late-thread.txt", exact: true })
      .click();
    assert.equal(
      (
        await post("messages/list", {
          roomId: room.roomId,
          threadId: threads[0].threadId,
        })
      ).messages.length,
      1,
    );
  } finally {
    releaseUpload();
    await page.unrouteAll({ behavior: "wait" });
    await late.dispose();
  }
  await dt.dispose();
  return { threadId: threads[0].threadId, messageId: replies[0].messageId };
}
