import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const engine = process.env.RAH_MOBILE_ENGINE ?? "chromium";
const evidence = mkdtempSync(join(tmpdir(), `rah-mobile-${engine}-`));
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { assertInlineReferenceParity } from "./inline-reference-parity-scenario.mjs";
const fixture = await startShellFixture();
const browser = await (engine === "webkit"
  ? webkit.launch({ headless: true })
  : chromium.launch({
      headless: true,
      executablePath: await findChromeExecutable(),
    }));
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (e) {
    failures.push(name + ": " + e.message);
    console.log("FAIL", name, e.stack);
  }
}
async function navVisible() {
  const nav = page.getByRole("navigation", { name: "移动端主导航" });
  assert.equal(await nav.isVisible(), true, "navigation must be visible");
  const r = await nav.boundingBox();
  assert.equal(Math.round(r.y + r.height), 844);
  for (const name of ["主页", "任务", "成员", "设置"])
    assert.equal(
      await nav.getByRole("button", { name, exact: true }).isVisible(),
      true,
    );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
}
try {
  for (const surface of [
    "agents",
    "computers",
    "settings",
    "activity",
    "search",
    "room",
  ])
    await check("bottom navigation: " + surface, async () => {
      await page.goto(
        `${fixture.origin}/?surface=${surface}&room=${fixture.roomId}`,
      );
      await page.locator(".rah-product-shell").waitFor();
      await navVisible();
      await page.screenshot({ path: join(evidence, `${surface}.png`) });
      if (surface === "agents") {
        await page.locator(".rah-agent-member-row").first().click();
        await navVisible();
        await page.screenshot({ path: join(evidence, "agent-detail.png") });
        await page.reload();
        await page.locator(".rah-product-shell").waitFor();
        await navVisible();
      }
      if (surface === "room") {
        const composer = page.locator(".channel .composer");
        await composer.waitFor();
        const a = await composer.boundingBox(),
          b = await page.locator(".rah-mobile-nav").boundingBox();
        assert.ok(
          a.y + a.height <= b.y,
          "composer must clear bottom navigation",
        );
        await page.locator(".channel .msg").last().hover();
        await page
          .locator(".channel .msg")
          .last()
          .getByRole("button", { name: "在消息列中回复", exact: true })
          .click();
        const thread = page.getByTestId("thread-side-column");
        await thread.waitFor();
        await navVisible();
        const c = await page
          .locator(".rah-product-shell > .thread")
          .boundingBox();
        assert.ok(c.y + c.height <= b.y, "thread must clear navigation");
        await page.screenshot({ path: join(evidence, "thread.png") });
      }
    });
  for (const scope of ["global", "room"])
    await check("responsive tasks: " + scope, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(
        `${fixture.origin}/?surface=${scope === "global" ? "tasks" : "room"}&room=${fixture.roomId}`,
      );
      if (scope === "room")
        await page.getByRole("tab", { name: "任务", exact: true }).click();
      const list = page.getByRole("radio", { name: "列表", exact: true }),
        board = page.getByRole("radio", { name: "看板", exact: true });
      await list.waitFor();
      await page.waitForTimeout(200);
      assert.equal(
        await list.getAttribute("aria-checked"),
        "true",
        "narrow default must be list",
      );
      await page.screenshot({ path: join(evidence, `${scope}-tasks.png`) });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(200);
      assert.equal(
        await board.getAttribute("aria-checked"),
        "true",
        "wide default must be board",
      );
      assert.equal(
        await page.locator(".rah-mobile-nav").isVisible(),
        false,
        "desktop keeps the rail",
      );
      const pane = page
        .locator(scope === "global" ? '[aria-label="全局任务"]' : ".chan-pane")
        .first();
      await pane.evaluate((el) => (el.style.width = "600px"));
      await page.waitForTimeout(100);
      assert.equal(
        await list.getAttribute("aria-checked"),
        "true",
        "narrow container, wide viewport uses list",
      );
      await pane.evaluate((el) => el.style.removeProperty("width"));
      await page.waitForTimeout(100);

      await list.click();
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.waitForTimeout(200);
      assert.equal(
        await list.getAttribute("aria-checked"),
        "true",
        "explicit choice survives resize",
      );
    });
  await check("inline references match Raft line placement", () =>
    assertInlineReferenceParity(page),
  );
  if (failures.length) throw Error(failures.join("\n"));
  console.log(
    "Mobile layout gate passed (isolated fake-provider fixture)",
    evidence,
  );
} finally {
  await browser.close();
  await fixture.close();
}
