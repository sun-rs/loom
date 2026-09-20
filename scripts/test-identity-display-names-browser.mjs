import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.route("**/v3/client/agents/list", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const agent of data.agents)
      if (agent.handle.toLowerCase() === "alice")
        agent.currentRevision.displayName = "Alice Display";
    await route.fulfill({ response, json: data });
  });
  await page.goto(fixture.origin + "/?surface=agents");
  await page
    .locator(".rah-agent-member-row")
    .filter({ hasText: "Alice Display" })
    .click();
  await expect(page.locator(".rah-agent-profile-pane")).toContainText("@Alice");
  await page
    .locator(".rah-agent-member-row")
    .filter({ hasText: "Alice Display" })
    .dblclick();
  await expect(
    page.getByRole("textbox", { name: "消息输入框", exact: true }),
  ).toHaveAttribute("placeholder", "发送消息至 @Alice Display");
  await page.screenshot({ path: "/tmp/identity-display-names-browser.png" });
  console.log(
    "PASS renamed Agent profile display while canonical handle remains unchanged",
  );
} finally {
  await browser.close();
  await fixture.close();
}
