import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(6000);
  await page.goto(
    `${fixture.origin}/?surface=settings&settingsSection=appearance`,
  );
  const toggle = page.getByRole("checkbox", {
    name: "显示 Agent 模型",
    exact: true,
  });
  assert.equal(await toggle.isChecked(), false);
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-labelledby="rah-agent-model-label"]')
        ?.nextElementSibling?.getBoundingClientRect().width > 0,
  );
  assert.deepEqual(
    await toggle.evaluate((e) => {
      const r = e.nextElementSibling.getBoundingClientRect();
      return [r.width, r.height];
    }),
    [36, 20],
  );
  const model = page.locator(
    ".rah-settings-message-preview .rah-message-agent-model",
  );
  assert.equal(await model.isVisible(), false);
  await toggle.check();
  assert.equal(await model.innerText(), "preview");
  assert.equal(await model.isVisible(), true);
  assert.deepEqual(
    await model.evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.fontSize, s.lineHeight, s.color];
    }),
    ["11px", "11px", "rgba(0, 0, 0, 0.4)"],
  );
  await page.reload();
  assert.equal(await toggle.isChecked(), true);
  assert.equal(await model.isVisible(), true);
  await page.screenshot({
    path: "/tmp/rah-agent-model-appearance-desktop.png",
  });
  await toggle.uncheck();
  assert.equal(await model.isVisible(), false);
  await page.reload();
  assert.equal(await toggle.isChecked(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.check();
  assert.equal(await model.isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "/tmp/rah-agent-model-appearance-mobile.png" });
  await page.goto(
    `${fixture.origin}/test/settings-visual-fixture.html?modelMessages`,
  );
  const chatModel = page.locator(
    '[data-message-id="agent"] .rah-message-agent-model',
  );
  assert.equal(await chatModel.innerText(), "fixture/model");
  assert.equal(await chatModel.isVisible(), true);
  assert.equal(
    await page
      .locator('[data-message-id="human"] .rah-message-agent-model')
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator('[data-message-id="unconfigured"] .rah-message-agent-model')
      .count(),
    0,
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [id, label] of [
      ["aihubmix", "aihubmix/model"],
      ["deepseek", "deepseek/model"],
      ["codex", "codex/model"],
      ["claude", "claude/model"],
      ["kimi", "kimi/model"],
      ["grokbuild", "grokbuild/model"],
    ]) {
      const labelNode = page.locator(
        `[data-message-id="${id}"] .rah-message-agent-model`,
      );
      assert.equal(await labelNode.innerText(), label);
      assert.equal(await labelNode.getAttribute("title"), label);
      assert.equal(
        await labelNode.evaluate((e) => e.nextElementSibling.tagName),
        "TIME",
      );
    }
    await page.locator('[data-message-id="aihubmix"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/rah-provider-model-${width}.png` });
  }
  await toggle.uncheck();
  assert.equal(await chatModel.isVisible(), false);
  await toggle.check();
  assert.equal(await chatModel.isVisible(), true);
  await page.reload();
  assert.equal(await chatModel.isVisible(), true);
  console.log(
    "Appearance toggle: immediate preview, saved reload, desktop and mobile passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
