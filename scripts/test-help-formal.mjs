import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const output = process.env.RAH_HELP_EVIDENCE;
assert.ok(output);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(
    "http://127.0.0.1:4173/?surface=settings&settingsSection=release-notes",
  );
  await page.getByRole("heading", { name: "更新日志", exact: true }).waitFor();
  await page.clock.install();
  await page.getByRole("button", { name: "设置", exact: true }).hover();
  await page.clock.runFor(50);
  const tooltip = page.getByRole("tooltip", { name: "设置", exact: true });
  assert.equal(await tooltip.count(), 1);
  await page.screenshot({
    path: `${output}/tooltip.png`,
    animations: "disabled",
  });
  await page.locator(".rail-btn[aria-label=帮助]").click();
  await page.getByRole("heading", { name: "帮助", exact: true }).waitFor();
  await page.getByRole("heading", { name: "本机恢复", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "帮助与资源", exact: true }).count(),
    0,
  );
  assert.equal(page.context().pages().length, 1);
  await page.reload();
  await page.getByRole("heading", { name: "本机恢复", exact: true }).waitFor();
  await page.mouse.move(600, 60);
  await page.keyboard.press("Escape");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `${output}/guide-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  console.log(
    "Formal Chrome: tooltip within 50ms virtual time, direct guide navigation, reload, desktop/mobile passed.",
  );
} finally {
  await browser.close();
}
