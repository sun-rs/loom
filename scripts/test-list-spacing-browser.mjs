import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await (
    process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
  ).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(fixture.origin + "/?surface=agents");
  const list = page.locator(".rah-agent-directory-list");
  await expect(list.locator(".rah-agent-member-row").first()).toBeVisible();
  const measure = () =>
    list.evaluate((el) => {
      const rect = (s) => el.querySelector(s).getBoundingClientRect(),
        css = (s) => getComputedStyle(el.querySelector(s));
      const rows = [
        ...el.querySelectorAll(
          ".rah-agent-sidebar-section:first-of-type .rah-agent-member-row",
        ),
      ];
      const r = el
          .querySelector(".rah-agent-relationship")
          .getBoundingClientRect(),
        h = rect(".rah-agent-sidebar-section > header"),
        c = rect(".rah-agent-computer-label");
      const last = rows.at(-1).getBoundingClientRect(),
        human = rect(".rah-agent-human-section > header");
      return {
        rowHeight: rows[0].getBoundingClientRect().height,
        rowGap:
          rows[1].getBoundingClientRect().top -
          rows[0].getBoundingClientRect().bottom,
        avatarGap: parseFloat(css(".rah-agent-member-row").gap),
        relationshipGap: parseFloat(css(".rah-agent-relationship").gap),
        sectionGap: h.top - r.bottom,
        humanSectionGap: human.top - last.bottom,
        headerGap: parseFloat(css(".rah-agent-sidebar-section > header").gap),
        headerBottom: parseFloat(
          css(".rah-agent-sidebar-section > header").marginBottom,
        ),
        computerHeight: c.height,
        computerTop: c.top - h.bottom,
        computerBottom: rows[0].getBoundingClientRect().top - c.bottom,
      };
    });
  const actual = await measure();
  console.log(actual);
  assert.deepEqual(actual, {
    rowHeight: 32,
    rowGap: 4,
    avatarGap: 6,
    relationshipGap: 6,
    sectionGap: 12,
    humanSectionGap: 12,
    headerGap: 4,
    headerBottom: 4,
    computerHeight: 15,
    computerTop: 6,
    computerBottom: 2,
  });
  await page.screenshot({ path: "/tmp/rah-member-spacing-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.origin + "/?surface=agents");
  await expect(list.locator(".rah-agent-member-row").first()).toBeVisible();
  await expect(list.locator(".rah-agent-member-row").first()).toHaveCSS(
    "gap",
    "6px",
  );
  await page.screenshot({ path: "/tmp/rah-member-spacing-mobile.png" });
  console.log("PASS member section, computer label and adjacent row geometry");
} finally {
  await browser.close();
  await fixture.close();
}
