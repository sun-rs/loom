import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const output = mkdtempSync(join(tmpdir(), "rah-responsive-"));
const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(fixture.origin + "/?room=" + fixture.roomId);
  await page.locator(".channel .msg").last().hover();
  await page
    .locator(".channel .msg")
    .last()
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  const thread = page.getByTestId("thread-side-column");
  await thread.waitFor();
  // Counterfactual regression probes reproduce the removed local rules only.
  if (process.env.RAH_RESPONSIVE_COUNTERFACTUAL === "gap")
    await page.addStyleTag({
      content:
        ".rah-product-shell > .thread > .messages { padding-top:12px } .rah-thread-parent { padding:8px 12px }",
    });
  if (process.env.RAH_RESPONSIVE_COUNTERFACTUAL === "overlay")
    await page.addStyleTag({
      content:
        "@media(max-width:1279.98px){.rah-product-shell[data-conversation-layout] > .thread {position:fixed;top:0;right:0;bottom:0;left:auto;width:400px} .rah-product-shell[data-conversation-layout]:not(.thread-hidden){grid-template-columns:var(--rail-w) var(--sidebar-w) minmax(0,1fr)}}",
    });

  await thread.locator("textarea").fill("Unsent responsive draft");
  const measures = [];
  for (const [width, height, mode] of [
    [1440, 900, "split"],
    [1200, 900, "split"],
    [984, 900, "split"],
    [983, 900, "replace"],
    [1000, 1200, "replace"],
    [1280, 1500, "split"],
    [768, 900, "replace"],
    [767, 900, "fullscreen"],
    [390, 844, "fullscreen"],
    [1440, 900, "split"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(80);
    const m = await page.evaluate(() => {
      const box = (s) => {
        const e = document.querySelector(s),
          r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          display: getComputedStyle(e).display,
        };
      };
      return {
        thread: box(".rah-product-shell > .thread"),
        channel: box(".rah-product-shell > .channel"),
        parent: box(".rah-thread-parent .msg"),
        head: box(".rah-thread-head"),
      };
    });
    measures.push({ width, height, mode, ...m });
    if (mode === "split") {
      assert.equal(m.thread.x, m.channel.x + m.channel.w);
      assert.ok(m.channel.w >= 320);
      assert.ok(m.thread.w <= 400);
    } else {
      assert.equal(m.channel.display, "none");
      assert.equal(m.thread.x, mode === "fullscreen" ? 0 : 304);
      assert.equal(m.thread.w, width - m.thread.x);
    }
    assert.equal(
      await thread.locator("textarea").inputValue(),
      "Unsent responsive draft",
    );
    assert.equal(
      m.parent.y - (m.head.y + m.head.h),
      18,
      "Raft root wrapper 12px + message margin 6px",
    );
    await page.screenshot({ path: join(output, `${width}-${height}.png`) });
  }
  // A user-expanded sidebar changes the container breakpoint without changing
  // the viewport contract. Real pointer drag, not a stored-width fixture.
  const divider = await page.locator(".rah-room-sidebar-resizer").boundingBox();
  assert.ok(divider);
  await page.mouse.move(divider.x + divider.width / 2, 200);
  await page.mouse.down();
  await page.mouse.move(divider.x + divider.width / 2 + 120, 200, {
    steps: 10,
  });
  await page.mouse.up();
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(80);
  assert.equal(
    await page
      .locator(".rah-product-shell")
      .getAttribute("data-conversation-layout"),
    "replace",
  );
  // Restore the sidebar with its supported keyboard minimum/default boundary.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".rah-room-sidebar-resizer").focus();
  await page.keyboard.press("End");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await page.setViewportSize({ width: 390, height: 844 });
  await thread.getByRole("button", { name: "返回聊天", exact: true }).click();
  await page
    .locator(".rah-product-shell > .channel")
    .waitFor({ state: "visible" });
  assert.equal(
    (await page.locator(".rah-product-shell > .channel").boundingBox()).x,
    0,
  );
  await page.setViewportSize({ width: 800, height: 900 });
  assert.equal(
    (await page.locator(".rah-product-shell > .channel").boundingBox()).x,
    304,
  );
  writeFileSync(
    join(output, "measurements.json"),
    JSON.stringify(measures, null, 2),
  );
  console.log(JSON.stringify({ output, status: "passed" }));
} catch (e) {
  await page.screenshot({ path: join(output, "failure.png") });
  console.error(output);
  throw e;
} finally {
  await browser.close();
  await fixture.close();
}
