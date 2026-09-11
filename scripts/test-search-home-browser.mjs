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
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(
    fixture.origin + "/?room=" + fixture.roomId + "&surface=search&q=Council",
  );
  const result = page.locator(".rah-search-destination").first();
  await result.waitFor();
  await result.click();
  await page.goto(
    fixture.origin + "/?room=" + fixture.roomId + "&surface=search",
  );
  await page.getByRole("heading", { name: "搜索历史", exact: true }).waitFor();
  assert.equal(
    (await page.locator(".rah-search-common").count()) > 0,
    true,
    "opened destination appears as common card",
  );
  const history = await page
    .locator(".rah-search-history-section")
    .boundingBox();
  const common = await page.locator(".rah-search-common-section").boundingBox();
  assert.ok(
    common.y >= history.y + history.height,
    "history precedes common cards",
  );
  await page.getByRole("button", { name: "清除", exact: true }).click();
  assert.equal(await page.locator(".rah-search-history-section").count(), 0);
  assert.ok(
    await page.locator(".rah-search-common").count(),
    "clearing queries preserves entity usage",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: "/tmp/rah-search-home-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fixture.origin + "/?surface=search&q=History");
  await page.locator(".rah-search-hit").first().waitFor();
  const meta = page.locator(".rah-search-hit-meta").first();
  assert.ok(await meta.locator('[role="img"]').count());
  assert.match(await meta.locator("time").innerText(), /前|现在|此刻/);
  assert.equal(
    await page
      .locator(".rah-search-excerpt")
      .first()
      .evaluate((e) => getComputedStyle(e).webkitLineClamp),
    "2",
  );
  await page.screenshot({ path: "/tmp/rah-search-results-desktop.png" });
  await page.locator(".rah-search-hit").first().click();
  await page.locator(".channel").waitFor();
  const workspaceResponse = await page.request.post(
    fixture.origin + "/v3/client/workspaces/list",
    { data: {} },
  );
  const workspace = (await workspaceResponse.json()).workspaces[0];
  const directoryResponse = await page.request.post(
    fixture.origin + "/v3/client/search",
    { data: { workspaceId: workspace.workspaceId, query: "" } },
  );
  const person = (await directoryResponse.json()).principals.find(
    (person) => person.kind === "agent",
  );
  assert.ok(person);
  await page.goto(
    fixture.origin + "/?surface=search&q=" + encodeURIComponent(person.handle),
  );
  const avatar = page.locator('.rah-search-destination [role="img"]').first();
  await avatar.waitFor();
  assert.equal((await avatar.boundingBox()).width, 32);
  console.log("Search home and message result source-backed behavior passed");
} finally {
  await browser.close();
  await fixture.close();
}
