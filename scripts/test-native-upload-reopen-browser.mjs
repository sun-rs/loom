import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const evidence = mkdtempSync(`${tmpdir()}/rah-native-upload-reopen-`);
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  const form = page.locator("main.channel form.composer");
  const editor = form.getByRole("textbox", { name: "消息输入框", exact: true });
  await expect(editor).toBeEnabled();
  await editor.fill("keep this draft");
  await editor.evaluate((e) => e.setSelectionRange(4, 4));
  const upload = form.getByRole("button", {
    name: "上传此设备的文件",
    exact: true,
  });
  const input = form.getByLabel("选择附件", { exact: true });
  await expect(upload).toHaveCSS("width", "26px");
  await expect(upload).toHaveCSS("height", "26px");
  await input.evaluate((e) => {
    window.__nativeUploadClicks = [];
    e.addEventListener("click", (event) =>
      window.__nativeUploadClicks.push(event.isTrusted),
    );
  });
  let opened = 0;
  page.on("filechooser", () => opened++);
  for (let attempt = 0; attempt < 4; attempt++) {
    const waiting = page.waitForEvent("filechooser");
    await upload.tap();
    const chooser = await waiting;
    assert.equal(chooser.isMultiple(), true);
    assert.equal(await chooser.element().getAttribute("accept"), null);
    assert.equal(await chooser.element().getAttribute("capture"), null);
    assert.equal(
      await input.evaluate(() => window.__nativeUploadClicks.at(-1)),
      true,
      "Touch must activate the native file input directly, not synthesize a click after canceling pointerdown",
    );
    // Automation models cancellation at the DOM boundary, not the iOS system sheet.
    await chooser.setFiles([]);
    await input.dispatchEvent("cancel", { bubbles: true });
    assert.equal(opened, attempt + 1, "Each touch opens exactly one chooser");
    await expect(editor).toHaveValue("keep this draft");
    assert.deepEqual(
      await editor.evaluate((e) => [e.selectionStart, e.selectionEnd]),
      [4, 4],
    );
    await expect(form.locator(".rah-file-draft")).toHaveCount(0);
  }
  const file = {
    name: "reopen.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("same file twice"),
  };
  for (const key of ["Enter", "Space"]) {
    await upload.focus();
    const waiting = page.waitForEvent("filechooser");
    await upload.press(key);
    await (await waiting).setFiles(file);
    await expect(form.getByText("已上传", { exact: true })).toBeVisible();
    await expect(input).toHaveValue("");
    await form.getByLabel("移除附件 reopen.txt", { exact: true }).click();
  }
  assert.equal(opened, 6);
  await page.screenshot({ path: `${evidence}/mobile-upload.png` });
  await form.locator("label.task-check").click();
  await expect(upload).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(upload).toHaveCSS("opacity", "0.4");
  await expect(upload).toHaveCSS("transform", "none");
  await input.setInputFiles(file);
  await expect(form.locator(".rah-file-draft")).toHaveCount(0);
  await form.locator("label.task-check").click();
  await expect(upload).toBeEnabled();
  const reopened = page.waitForEvent("filechooser");
  await upload.tap();
  await (await reopened).setFiles([]);
  assert.equal(opened, 7);
  const borderChooser = page.waitForEvent("filechooser");
  await upload.tap({ position: { x: 1, y: 1 } });
  await (await borderChooser).setFiles([]);
  assert.equal(
    opened,
    8,
    "Wrapper border activation opens once, without bubbling recursion",
  );
  console.log(JSON.stringify({ evidence }));
  console.log(
    "PASS: four consecutive trusted touches/cancels, Enter/Space, same-file reselection, draft/caret preserved.",
  );
} finally {
  await browser.close();
  await fixture.close();
}
