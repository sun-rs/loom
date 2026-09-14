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
  await p.goto(f.origin);
  await p.locator(".rail-footer-item--notifications .rail-btn").hover();
  await p.getByText("暂无通知", { exact: true }).waitFor();
  assert.equal(
    await p.getByRole("tooltip", { name: "通知", exact: true }).count(),
    0,
    "notification popover replaces the short tooltip",
  );
  await p.screenshot({ path: "/tmp/rah-notification-popover-fixed.png" });
  console.log("Notification hover has one surface");
} finally {
  await b.close();
  await f.close();
}
