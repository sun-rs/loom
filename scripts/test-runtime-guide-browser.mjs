import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=runtime",
    );
    await page.waitForURL("**settingsSection=administration");
    const content = page.locator(".rah-runtime-settings");
    await content.getByRole("heading", { name: "CLI 启动信息" }).waitFor();
    for (const card of await content
      .locator(".rah-runtime-settings-card")
      .all()) {
      assert.equal(await card.locator("details").getAttribute("open"), "");
      assert.equal(
        await card.getByText("系统启动命令", { exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await card.getByText("系统环境变量", { exact: true }).count(),
        (await card.getAttribute("aria-label")) === "Claude Code" ? 1 : 0,
      );
      assert.equal(
        await card
          .locator("input:not([type=checkbox]), textarea, select, button")
          .count(),
        0,
      );
    }
    assert.equal(
      await content.getByText("无固定环境变量", { exact: true }).count(),
      0,
    );
    const env = content.getByLabel("claude 系统环境变量");
    const gap = await env.evaluate((el) => {
      const heading = el.previousElementSibling;
      const command = el.parentElement.previousElementSibling;
      return (
        heading.getBoundingClientRect().top -
        command.getBoundingClientRect().bottom
      );
    });
    assert.ok(gap >= 16, `launch/environment gap ${gap}`);
    for (const pre of await content.locator("pre").all()) {
      assert.equal(
        await pre.evaluate((el) => getComputedStyle(el).overflowY),
        "visible",
      );
      assert.equal(
        await pre.evaluate((el) => getComputedStyle(el).whiteSpace),
        "pre-wrap",
      );
    }
    const toggle = content.getByRole("checkbox", {
      name: "Codex Guide",
      exact: true,
    });
    assert.equal(await toggle.isChecked(), true);
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Codex Guide"]').checked === false,
    );
    assert.equal(
      await content
        .getByRole("checkbox", { name: "Claude Code Guide", exact: true })
        .isChecked(),
      true,
    );
    await toggle.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Codex Guide"]').checked === true,
    );
    for (const name of ["Kimi Guide", "OpenCode Guide"])
      assert.equal(
        await content.getByRole("checkbox", { name, exact: true }).isDisabled(),
        true,
      );
    assert.equal(
      await content.getByLabel("claude 系统环境变量").innerText(),
      "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1",
    );
    assert.equal(
      await content.getByLabel("codex 系统启动命令").innerText(),
      "codex\napp-server",
    );
    assert.ok(!(await content.innerText()).includes("legacy-secret"));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      viewport.width,
    );
    await page.screenshot({
      path: `/tmp/rah-provider-readonly-${viewport.width}.png`,
    });
    await content.locator("summary").first().click();
    assert.equal(
      await content.locator("details").first().getAttribute("open"),
      null,
    );
    await page.reload();
    await content.getByRole("heading", { name: "CLI 启动信息" }).waitFor();
    assert.equal(
      await content
        .locator("input:not([type=checkbox]), textarea, select, button")
        .count(),
      0,
    );
    assert.equal(await content.locator("details[open]").count(), 4);
    await page.close();
  }
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const touchPage = await mobile.newPage();
  await touchPage.goto(
    server.resolvedUrls.local[0] +
      "test/runtime-guide-fixture.html?settingsSection=administration&longLaunch=1",
  );
  const command = touchPage.getByLabel("codex 系统启动命令");
  await command.waitFor();
  const scroll = touchPage.locator(".rah-settings-scroll");
  const box = await command.boundingBox();
  const scrollerBox = await scroll.boundingBox();
  const startY = Math.min(box.y + 100, scrollerBox.y + scrollerBox.height - 40);

  const session = await mobile.newCDPSession(touchPage);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 150, y: startY }],
  });
  for (let i = 1; i <= 10; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 150, y: startY - i * 12 }],
    });
    await touchPage.waitForTimeout(20);
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touchPage.waitForFunction(
    () => document.querySelector(".rah-settings-scroll").scrollTop > 50,
  );
  assert.equal(await command.evaluate((el) => el.scrollTop), 0);
  assert.equal(
    await touchPage.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await touchPage.screenshot({ path: "/tmp/rah-provider-touch-scroll.png" });
  await mobile.close();
  const safari = await webkit.launch({ headless: true });
  try {
    const page = await safari.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=administration&longLaunch=1",
    );
    const pre = page.getByLabel("codex 系统启动命令");
    await pre.waitFor();
    assert.equal(
      await pre.evaluate((el) => getComputedStyle(el).overflowY),
      "visible",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await page.mouse.move(150, 500);
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(
      () => document.querySelector(".rah-settings-scroll").scrollTop > 50,
    );
    await page.screenshot({ path: "/tmp/rah-provider-webkit-scroll.png" });
  } finally {
    await safari.close();
  }
  console.log(
    "Provider Settings read-only commands/environment, reload, desktop/mobile passed",
  );
} finally {
  await browser.close();
  await server.close();
}
