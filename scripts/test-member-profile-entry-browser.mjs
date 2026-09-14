import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE ?? "chrome";
const browser = await (engine === "firefox" ? firefox : chromium).launch({
  headless: true,
  ...(engine === "chrome"
    ? { executablePath: await findChromeExecutable() }
    : {}),
});
try {
  const page = await browser.newPage();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(fixture.origin + "/?surface=agents");
    const humanRow = page
      .locator(".rah-agent-human-section .rah-agent-member-row")
      .first();
    await humanRow.click();
    await expect(page.locator(".rah-agent-peek")).toHaveCount(0);
    const human = page.getByRole("region", { name: "Human 详情", exact: true });
    await expect(human).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("memberView"), "human");
    const href = page.url();
    await page.reload();
    await expect(human).toBeVisible();
    await expect(page.locator(".rah-agent-directory-page")).toHaveCount(1);
    await expect
      .poll(async () => (await human.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(width === 390 ? 380 : 1000);
    await expect(
      page.getByRole("button", { name: "关闭 Human 侧栏" }),
    ).toHaveCount(0);
    // Human's owned-Agent cards must replace the same profile, never open a second pane.
    const ownedAgent = human
      .getByRole("button", { name: /^打开 .* Agent 资料$/ })
      .first();
    await ownedAgent.click();
    await expect(human).toHaveCount(0);
    await expect(page.locator(".rah-agent-peek")).toHaveCount(0);
    await expect(page.locator(".rah-agent-directory-page")).toHaveCount(1);
    assert.ok(new URL(page.url()).searchParams.get("agent"));
    await page.goBack();
    await expect(human).toBeVisible();
    assert.equal(page.url(), href);
    await page.screenshot({ path: `/tmp/member-entry-${engine}-${width}.png` });
    await page.goto(fixture.origin + "/?room=" + fixture.roomId);
    const composer = page.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await composer.fill("unsent entry fixture");
    const roomUrl = page.url();
    await page
      .locator('[data-message-id] button[aria-label="查看 sun 资料"]')
      .first()
      .click();
    await expect(
      page.getByRole("main", { name: "Human 详情侧栏" }),
    ).toBeVisible();
    assert.equal(page.url(), roomUrl);
    await page
      .getByRole("main", { name: "Human 详情侧栏" })
      .getByRole("button", { name: /^打开 .* Agent 资料$/ })
      .first()
      .click();
    await expect(
      page.getByRole("main", { name: "Agent 详情侧栏" }),
    ).toBeVisible();
    await expect(page.locator(".rah-agent-peek")).toHaveCount(1);
    assert.equal(page.url(), roomUrl);
    await page.getByRole("button", { name: "关闭 Agent 侧栏" }).click();
    await expect(composer).toHaveValue("unsent entry fixture");
    console.log(
      `${engine} ${width}: member full profiles, owned Agent, reload/back, chat Human peek and draft passed`,
    );
  }
} finally {
  await browser.close();
  await fixture.close();
}
