import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(fixture.origin + "/?surface=agents");
  await page.locator(".rah-agent-member-row").first().click();
  const edit = page.getByRole("button", {
    name: "编辑运行时配置",
    exact: true,
  });
  await edit.waitFor();
  await page.mouse.move(0, 0);
  const background = () =>
    edit.evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(await background(), "rgba(0, 0, 0, 0)");
  await edit.hover();
  await edit.evaluate((e) =>
    Promise.all(e.getAnimations().map((animation) => animation.finished)),
  );
  assert.equal(
    await background(),
    "rgba(0, 0, 0, 0)",
    "hover changes pencil color only, never its background",
  );
  await page.screenshot({ path: "/tmp/rah-runtime-edit-hover.png" });
  await edit.click();
  const dialog = page.getByRole("dialog", {
    name: "编辑运行时配置",
    exact: true,
  });
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await edit.press("Enter");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await edit.evaluate((e) => e === document.activeElement), true);
  console.log(
    "Runtime pencil: transparent rest/hover, pointer activation, Enter and Escape focus return passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
