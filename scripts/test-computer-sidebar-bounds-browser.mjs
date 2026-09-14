import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const f = await startShellFixture();
const b = await chromium.launch({
  executablePath: await findChromeExecutable(),
  headless: true,
});
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [surface, label] of [
    ["computers", "调整计算机边栏宽度"],
    ["agents", "调整成员边栏宽度"],
  ]) {
    await p.goto(f.origin + "/?surface=" + surface);
    const r = p.getByRole("separator", { name: label });
    await r.waitFor();
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    assert.equal(await r.getAttribute("aria-valuenow"), "240");
    for (const [x, expected] of [
      [1100, 320],
      [0, 180],
    ]) {
      const rect = await r.evaluate((e) => ({
        x: e.getBoundingClientRect().x,
        y: e.getBoundingClientRect().y,
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      }));

      await p.mouse.move(rect.x + rect.width / 2, rect.y + 140);
      await p.mouse.down();
      await p.mouse.move(x, rect.y + 140, { steps: 15 });
      await p.mouse.up();
      assert.equal(
        await r.getAttribute("aria-valuenow"),
        String(expected),
        surface + " actual pointer bound",
      );
    }
    await r.focus();
    await p.keyboard.press("End");
    assert.equal(await r.getAttribute("aria-valuenow"), "320");
    await p.screenshot({ path: "/tmp/sidebar-bounds-" + surface + ".png" });
  }
  console.log(
    "PASS Computer and members default240, pointer/keyboard 180–320 bounds",
  );
} finally {
  await b.close();
  await f.close();
}
