import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, firefox } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";

const output = process.env.RAH_MCP_RETIREMENT_EVIDENCE;
if (!output) throw new Error("RAH_MCP_RETIREMENT_EVIDENCE is required");
mkdirSync(output, { recursive: true });
const results = [];
for (const engine of process.env.RAH_UI_BROWSER
  ? [process.env.RAH_UI_BROWSER]
  : ["chrome", "firefox"]) {
  const fixture = await startShellFixture();
  const browser = await (engine === "chrome" ? chromium : firefox).launch({
    headless: true,
    ...(engine === "chrome"
      ? { executablePath: await findChromeExecutable() }
      : {}),
  });
  try {
    const page = await browser.newPage();
    const retiredRequests = [];
    const errors = [];
    page.on("request", (request) => {
      if (
        /\/(?:managed-mcp|worker\/mcp)\//u.test(new URL(request.url()).pathname)
      )
        retiredRequests.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("rah:web-push-desired:v1", "disabled"),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(fixture.origin + "/?surface=agents");
    await page.locator(".rah-agent-member-row").first().click();
    await page.locator(".rah-agent-profile-pane").waitFor();
    const agentId = new URL(page.url()).searchParams.get("agent");
    assert.ok(
      agentId,
      "Select a real fixture Agent before testing an old deep link",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(
        fixture.origin + "/?surface=settings&settingsSection=managed-mcp",
      );
      await page.locator(".rah-settings-surface").waitFor();
      await page.getByRole("heading", { name: "账户", exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "MCP 服务器", exact: true })
          .count(),
        0,
      );
      await page.reload();
      await page.getByRole("heading", { name: "账户", exact: true }).waitFor();
      await page.screenshot({
        path: join(output, `${engine}-${width}-settings.png`),
      });
      await page.goto(
        fixture.origin +
          "/?surface=agents&agent=" +
          encodeURIComponent(agentId) +
          "&agentTab=mcp",
      );
      await page.locator(".rah-agent-profile-pane").waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("agent"),
        agentId,
        "Old MCP link preserves the selected Agent identity",
      );
      const tabs = page.getByRole("tablist", { name: "Agent 详情" });
      assert.equal(
        await tabs.getByRole("tab", { name: "MCP", exact: true }).count(),
        0,
      );
      assert.equal(
        await tabs
          .getByRole("tab", { name: "资料", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await page.reload();
      await page.locator(".rah-agent-profile-pane").waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("agent"),
        agentId,
        "Old MCP link preserves the selected Agent identity",
      );
      assert.equal(
        await tabs
          .getByRole("tab", { name: "资料", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: join(output, `${engine}-${width}-agent.png`),
      });
      assert.deepEqual(
        retiredRequests,
        [],
        "Retired module must not issue browser API requests",
      );
      assert.deepEqual(errors, []);
      results.push({
        engine,
        width,
        settingsFallback: "account",
        agentFallback: "profile",
        retiredRequests: 0,
        status: "passed",
      });
    }
  } finally {
    await browser.close();
    await fixture.close();
  }
}
writeFileSync(
  join(output, "receipt.json"),
  JSON.stringify(results, null, 2) + "\n",
);
console.log(JSON.stringify(results));
