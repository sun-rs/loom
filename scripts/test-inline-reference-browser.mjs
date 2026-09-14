import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { assertInlineReferenceParity } from "./inline-reference-parity-scenario.mjs";

const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage();
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await page.locator(".rah-product-shell").waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await assertInlineReferenceParity(page);
  }
  console.log(
    "PASS inline references: same-text Raft geometry, wrapping, and selection (isolated fixture)",
  );
} finally {
  await browser.close();
  await fixture.close();
}
