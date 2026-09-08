import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright/test";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
test("HTML rectangle joins paragraphs; inline and duplicate quotes relocate; selection survives jump", async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: await findChromeExecutable(),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 700 },
    });
    await page.setContent(
      '<p>First <b>bold</b> paragraph</p><p>Second paragraph</p><div style="height:900px"></div><p id="duplicate">First <b>bold</b> paragraph</p>',
    );
    await page.evaluate(() => {
      window.anchors = [];
      window.addEventListener("message", (e) => {
        if (e.data.type === "anchor") window.anchors.push(e.data.data);
      });
    });
    await page.addScriptTag({
      content: readFileSync(
        "apps/web/src/html-preview-bridge.js",
        "utf8",
      ).replace("document.currentScript.dataset.channel", '"test"'),
    });
    await page.evaluate(() =>
      window.postMessage({ rahHtml: "test", type: "mode", enabled: true }, "*"),
    );
    await page.getByText("点击或拖动以对区域评论", { exact: true }).waitFor();
    await page.mouse.move(9, 17);
    await page.mouse.down();
    await page.mouse.move(350, 85, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => window.anchors.length === 1);
    const anchor = await page.evaluate(() => window.anchors[0]);
    assert.equal(
      anchor.quote,
      "First ... bold ... paragraph ... Second paragraph",
    );
    const target = await page
      .locator("#duplicate")
      .evaluate((e) => ({ y: e.offsetTop, height: e.offsetHeight }));
    await page.evaluate(
      ({ y }) =>
        window.postMessage(
          {
            rahHtml: "test",
            type: "jump",
            data: { x: 0, y, w: 20, h: 20, quote: "First bold paragraph" },
          },
          "*",
        ),
      target,
    );
    await page.locator("[data-rah-region-highlight]").waitFor();
    const result = await page
      .locator("[data-rah-region-highlight]")
      .evaluate((e) => ({
        top: parseFloat(e.style.top),
        height: parseFloat(e.style.height),
        background: getComputedStyle(e).backgroundColor,
        border: e.style.border,
      }));
    assert.equal(result.top, target.y);
    assert.equal(result.height, target.height);
    assert.equal(
      await page.getByText("点击或拖动以对区域评论", { exact: true }).count(),
      1,
    );
    assert.equal(result.background, "rgb(255, 212, 64)");
  } finally {
    await browser.close();
  }
});
