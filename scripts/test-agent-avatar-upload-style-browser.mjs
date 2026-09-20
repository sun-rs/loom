import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const engine = process.env.RAH_BROWSER ?? "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${fixture.origin}/?surface=agents`);
    await page
      .locator(
        ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
      )
      .first()
      .click();
    await page.getByRole("tab", { name: "资料", exact: true }).click();
    await page.getByRole("button", { name: /^更换 .* 头像$/ }).click();
    const upload = page.getByRole("button", { name: "上传图片", exact: true });
    await page.mouse.move(0, 0);
    await expect(upload).toHaveCSS("width", "40px");
    await expect(upload).toHaveCSS(
      "background-color",
      /^(rgb\(255, 255, 255\)|oklch\(1 0 0\))$/,
    );
    const before = await upload.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      color: getComputedStyle(element).color,
      border: getComputedStyle(element).borderColor,
    }));
    await upload.hover();
    await expect(upload).toHaveCSS("background-color", before.background);
    await expect(upload).toHaveCSS("color", before.color);
    await expect(upload).not.toHaveCSS("border-color", before.border);
    await expect(upload.locator("use")).toHaveAttribute(
      "href",
      /#raft-icon-upload$/,
    );
    await expect(upload.locator("svg")).toHaveCSS("width", "16px");
    await expect(upload.locator("svg")).toHaveCSS("height", "16px");
    await expect(upload).toHaveCSS("color", "rgba(0, 0, 0, 0.6)");
    await page.screenshot({
      path: `/tmp/rah-avatar-upload-${engine}-${width}.png`,
    });
    await page.mouse.move(0, 0);
    await expect(upload).toHaveCSS("border-color", before.border);
    await upload.focus();
    await expect(upload).toHaveCSS("background-color", before.background);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    assert.ok(
      await chooserPromise,
      "keyboard activation still opens the file picker",
    );
  }
  console.log(
    `${engine}: avatar upload icon, hover, focus and file picker passed`,
  );
} finally {
  await browser.close();
  await fixture.close();
}
