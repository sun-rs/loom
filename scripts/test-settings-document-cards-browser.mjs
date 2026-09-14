import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({
    headless: true,
    executablePath: await findChromeExecutable(),
  });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(15000);
  await p.goto(f.origin + "/?surface=settings&settingsSection=release-notes");
  const entry = p.locator(".rah-settings-release");
  await entry.waitFor();
  await p.waitForTimeout(300);
  assert.equal(
    await entry.evaluate((e) => getComputedStyle(e).borderTopWidth),
    "2px",
  );
  await p.screenshot({ path: "/tmp/rah-release-cards-fixed.png" });
  await p.goto(f.origin + "/?surface=settings&settingsSection=docs");
  const section = p.locator(".rah-settings-guide section").first();
  await section.waitFor();
  await p.waitForTimeout(300);
  assert.equal(
    await section.evaluate((e) => getComputedStyle(e).borderTopWidth),
    "2px",
  );
  await p.screenshot({ path: "/tmp/rah-help-cards-fixed.png" });
  console.log("Release and help use document cards");
} finally {
  await b.close();
  await f.close();
}
