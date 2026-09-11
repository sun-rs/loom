import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 844 },
  });
  page.setDefaultTimeout(4000);
  await page.goto(
    server.resolvedUrls.local[0] + "test/settings-visual-fixture.html",
  );
  for (const name of ["设置", "搜索", "聊天", "Agent 与成员", "计算机"]) {
    const button = page.getByRole("button", { name, exact: true });
    assert.equal(await button.getAttribute("title"), null);
    await button.hover();
    const tip = page.getByRole("tooltip", { name, exact: true });
    await tip.waitFor();
    assert.equal(await tip.innerText(), name);
    const style = await tip.evaluate((e) => ({
      font: getComputedStyle(e).fontSize,
      padding: getComputedStyle(e).padding,
      border: getComputedStyle(e).borderWidth,
    }));
    assert.deepEqual(style, {
      font: "13px",
      padding: "4px 10px",
      border: "2px",
    });
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "hidden" });
    await page.mouse.move(400, 400);
    await page.keyboard.press("Tab");
    await button.focus();
    await tip.waitFor();
    await page.keyboard.press("Escape");
    await tip.waitFor({ state: "hidden" });
    await button.hover();
    await tip.waitFor();
    await page.mouse.move(400, 400);
    await tip.waitFor({ state: "hidden" });
  }
  console.log("Rail tooltip hover, keyboard, Escape and pointer exit passed");
} finally {
  await browser.close();
  await server.close();
}
