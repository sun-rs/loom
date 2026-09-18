import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
process.env.RAH_FIXTURE_COMPOSER_FILES = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-file-dialog-chrome-`);
const properties = [
  "fontSize",
  "fontWeight",
  "lineHeight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "borderBottomWidth",
  "borderBottomColor",
];
async function style(locator, keys = properties) {
  return locator.evaluate((element, names) => {
    const css = getComputedStyle(element);
    return Object.fromEntries(names.map((name) => [name, css[name]]));
  }, keys);
}
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    await page.goto(`${fixture.origin}/?surface=tasks`);
    const card = page.locator(".rah-global-card-open").first();
    await expect(card).toBeVisible();
    const room = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    await page.goto(`${fixture.origin}/?room=${room}`);
    await page.getByTestId("message-task-badge").first().click();
    const task = page.getByTestId("task-thread-modal");
    await expect(task).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const header = await style(task.locator("header").first());
    const roomLabel = await task.locator("header > div > span").textContent();
    const subtitle = await style(task.locator("header > div > span"));
    const headerHeight = (await task.locator("header").first().boundingBox())
      .height;
    const frameKeys = ["width", "maxHeight", "borderWidth", "boxShadow"];
    if (width > 767) frameKeys.push("height");
    const frame = await style(task, frameKeys);
    const title = await style(task.locator(".rah-task-detail-bar b"), [
      "fontSize",
      "fontWeight",
      "lineHeight",
    ]);
    const geometry = ["width", "height", "padding", "borderWidth", "boxShadow"];
    const close = task.getByLabel("关闭任务详情", { exact: true });
    const closeStyle = await style(close, geometry);
    const iconStyle = await style(close.locator("svg"), [
      "width",
      "height",
      "strokeWidth",
    ]);
    await close.click();
    const plus = page
      .locator("main.channel form.composer")
      .getByLabel("添加引用或附件", { exact: true });
    // The pointer handler deliberately preserves the editor caret; keyboard focus
    // on Plus gives the dialog protocol an explicit focus-return target.
    await plus.focus();
    await plus.click();
    const files = page.getByRole("dialog", { name: "引用计算机文件或文件夹" });
    await expect(files).toBeFocused();
    await expect(
      files.getByRole("button", { name: "引用所选", exact: true }),
    ).toBeEnabled();
    await expect(files.locator("header > div > span")).toHaveText(roomLabel);
    assert.deepEqual(
      await style(files.locator("header > div > span")),
      subtitle,
    );
    assert.equal(
      (await files.locator("header").boundingBox()).height,
      headerHeight,
    );
    assert.deepEqual(
      await style(files, frameKeys),
      frame,
      `${width}: shared approval frame`,
    );
    const home = files.getByLabel("返回用户主目录", { exact: true });
    await expect(home).toHaveCSS("width", "24px");
    await expect(home).toHaveCSS("height", "24px");
    await expect(home).toHaveCSS("border-width", "0px");
    await expect(home).toHaveCSS("box-shadow", "none");
    await expect(home.locator("svg")).toHaveCSS("width", "12px");
    assert.deepEqual(
      await style(files.locator("header")),
      header,
      `${width}: shared header spacing/border`,
    );
    assert.deepEqual(
      await style(files.getByText("引用文件或文件夹", { exact: true }), [
        "fontSize",
        "fontWeight",
        "lineHeight",
      ]),
      title,
      `${width}: shared title`,
    );
    const fileClose = files.getByLabel("关闭文件浏览", { exact: true });
    assert.deepEqual(
      await style(fileClose, geometry),
      closeStyle,
      `${width}: shared close control`,
    );
    assert.deepEqual(
      await style(fileClose.locator("svg"), ["width", "height", "strokeWidth"]),
      iconStyle,
    );
    // A plain shared primary button is the baseline, without file-dialog overrides.
    await files.evaluate((element) => {
      const baseline = document.createElement("button");
      baseline.className = "btn btn-pink";
      baseline.dataset.testid = "shared-primary-baseline";
      baseline.textContent = "引用所选";
      element.parentElement.append(baseline);
    });
    const baseline = page.getByTestId("shared-primary-baseline");
    assert.deepEqual(
      await style(files.getByRole("button", { name: "引用所选", exact: true })),
      await style(baseline),
    );
    await baseline.evaluate((element) => element.remove());
    await page.screenshot({ path: `${evidence}/${width}.png` });
    await page.keyboard.press("Escape");
    await expect(files).toHaveCount(0);
    await expect(plus).toBeFocused();
    await plus.click();
    await files
      .getByRole("button", {
        name: "打开文件夹 Folder with spaces",
        exact: true,
      })
      .click();
    const firstFile = files.getByRole("button", {
      name: "note.txt",
      exact: true,
    });
    const secondFile = files.getByRole("button", {
      name: "second note.txt",
      exact: true,
    });
    await firstFile.click();
    await secondFile.click();
    await expect(firstFile).toHaveAttribute("aria-pressed", "true");
    await expect(secondFile).toHaveAttribute("aria-pressed", "true");
    const softColor = "rgba(255, 212, 64, 0.3)";
    for (const file of [firstFile, secondFile]) {
      await expect(file.locator('use[href$="#raft-icon-check"]')).toHaveCount(
        1,
      );
      await expect(file).toHaveCSS("background-color", softColor);
    }
    await page.screenshot({ path: `${evidence}/${width}-selected-files.png` });
    await firstFile.click();
    await expect(firstFile).toHaveAttribute("aria-pressed", "false");
    await expect(
      firstFile.locator('use[href$="#raft-icon-check"]'),
    ).toHaveCount(0);
    await firstFile.click();
    const paths = await Promise.all([
      secondFile.getAttribute("title"),
      firstFile.getAttribute("title"),
    ]);
    await files.getByRole("button", { name: "引用所选", exact: true }).click();
    const editor = page.locator("main.channel form.composer textarea");
    await expect(editor).toHaveValue(
      `${paths.map((path) => `@${JSON.stringify(path)}`).join(" ")} `,
    );
    await expect(page.locator(".rah-file-draft")).toHaveCount(0);
    await plus.click();
    await page.getByLabel("关闭文件浏览", { exact: true }).click();
    await expect(files).toHaveCount(0);
    await page.locator("main.channel .msg").first().click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "打开消息列", exact: true })
      .click();
    const thread = page.getByRole("complementary", {
      name: "Thread 讨论",
      exact: true,
    });
    await thread.getByLabel("添加引用或附件", { exact: true }).click();
    await expect(files.locator("header > div > span")).toHaveText(roomLabel);
    await page.keyboard.press("Escape");
    await page.goto(fixture.origin);
    await page
      .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
      .first()
      .click();
    await expect(page.locator(".rah-direct-title")).toBeVisible();
    const directLabel = await page
      .locator("main.channel form.composer textarea")
      .getAttribute("placeholder");
    await plus.click();
    await expect(files.locator("header > div > span")).toHaveText(
      directLabel.replace("发送消息至 ", ""),
    );
    await expect(
      files.getByRole("heading", { name: "引用文件或文件夹" }),
    ).toBeVisible();
    await expect(
      files.getByRole("button", { name: "引用所选", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: `${evidence}/${width}-direct.png` });
    await page.keyboard.press("Escape");
    await page.close();
  }
  console.log(JSON.stringify({ passed: true, evidence }));
} finally {
  await browser.close();
  await fixture.close();
}
