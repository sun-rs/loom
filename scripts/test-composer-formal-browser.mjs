import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "playwright/test";
import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";

const { origin, databasePath } = parseFormalBrowserTarget(process.env);
const database = new DatabaseSync(databasePath, { readOnly: true });
const snapshot = () =>
  database
    .prepare(
      "SELECT room_id, max(room_seq) seq FROM room_events GROUP BY room_id ORDER BY room_id",
    )
    .all();
const before = snapshot();
const room = database
  .prepare(
    "SELECT room_id, name FROM rooms WHERE kind = 'channel' ORDER BY created_at LIMIT 1",
  )
  .get();
assert.ok(room, "A formal channel is required");
const output = mkdtempSync(join(tmpdir(), "rah-composer-formal-"));
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const rejected = [],
      errors = [],
      observed = new Set();
    await context.route("**/*", (route) => {
      const request = route.request();
      const result = classifyFormalBrowserRequest({
        method: request.method(),
        origin,
        url: request.url(),
      });
      if (result.decision === "reject") {
        rejected.push(result.identity);
        return route.abort();
      }
      observed.add(result.identity);
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?room=${encodeURIComponent(room.room_id)}`);
    const composer = page.locator("main.channel form.composer");
    await expect(
      composer.getByRole("textbox", { name: "消息输入框", exact: true }),
    ).toBeEnabled({ timeout: 20000 });
    await composer
      .getByRole("button", { name: "添加引用或附件", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "引用计算机文件或文件夹",
      exact: true,
    });
    await expect(dialog.locator("header > div > span")).toHaveText(
      `#${room.name}`,
    );
    await expect(
      dialog.getByRole("heading", { name: "引用文件或文件夹" }),
    ).toBeVisible();
    await expect(dialog).toBeFocused();
    const close = dialog.getByLabel("关闭文件浏览", { exact: true });
    await expect(close).toHaveCSS("width", width === 390 ? "32px" : "28px");
    await expect(close).toHaveCSS("border-width", "2px");
    const home = dialog.getByLabel("返回用户主目录", { exact: true });
    await expect(home).toHaveCSS("width", "24px");
    await expect(home).toHaveCSS("border-width", "0px");
    await expect(
      dialog.getByRole("button", { name: "引用所选", exact: true }),
    ).toBeEnabled();
    await expect(dialog.locator(".rah-computer-file-uploads")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "照片／拍照" }),
    ).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "设备文件" })).toHaveCount(
      0,
    );
    await expect(
      dialog.locator(".rah-computer-file-row").first(),
    ).toBeVisible();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: join(output, `${width}-files.png`) });
    await expect(dialog.getByLabel("目录根", { exact: true })).toHaveCount(0);
    await expect(dialog.locator(".rah-computer-file-path code")).toHaveText(
      homedir(),
    );
    let parent = homedir();
    while (parent !== "/") {
      parent = parent.slice(0, parent.lastIndexOf("/")) || "/";
      await dialog
        .getByRole("button", { name: "上一级目录", exact: true })
        .click();
      await expect(dialog.locator(".rah-computer-file-path code")).toHaveText(
        parent,
      );
      await expect(
        dialog.getByRole("button", { name: "引用所选", exact: true }),
      ).toBeEnabled();
    }
    await expect(
      dialog.getByRole("button", { name: "上一级目录", exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: join(output, `${width}-root.png`) });
    await dialog
      .getByRole("button", { name: "返回用户主目录", exact: true })
      .click();
    await expect(dialog.locator(".rah-computer-file-path code")).toHaveText(
      homedir(),
    );
    await expect(
      composer.getByRole("button", { name: "上传此设备的文件", exact: true }),
    ).toHaveCount(width === 390 ? 1 : 0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      composer.getByRole("textbox", { name: "消息输入框", exact: true }),
    ).toHaveValue("");
    await page.reload();
    await expect(
      composer.getByRole("button", { name: "添加引用或附件", exact: true }),
    ).toBeEnabled();
    assert.ok(observed.has("POST /v3/client/computers/files/list"));
    assert.deepEqual(rejected, []);
    assert.deepEqual(errors, []);
    results.push({
      width,
      status: "passed",
      observed: [...observed].filter((value) => value.startsWith("POST")),
    });
    await context.close();
  }
  assert.deepEqual(snapshot(), before, "formal content was not mutated");
} finally {
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify({ origin, results }, null, 2),
  );
  console.log(output);
  await browser.close();
  database.close();
}
