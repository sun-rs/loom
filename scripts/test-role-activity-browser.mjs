// Role identity comes from real temporary HTTP. Presence frames below are an
// explicit UI projection fixture, not proof of scheduler timing or paid work.
import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { roleBrowserFixture } from "./role-browser-fixture.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const f = await roleBrowserFixture(page, fixture);
  const room = await f.channel("fake-role-activity");
  const role = await f.createRole("ActivityFixture");
  const instance = await f.instantiate(role, room);
  let reason = "initializing";
  await page.route("**/v3/client/agents/presence/list", (route) =>
    route.fulfill({
      status: 200,
      json: {
        agents: [
          {
            agentId: instance.agentId,
            reason,
            activity: reason === "initializing" ? "offline" : "working",
            activityAt: new Date().toISOString(),
          },
        ],
        observedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto(`${fixture.origin}/?room=${room.roomId}`);
  const footer = page.getByTestId("live-agent-activity-bar");
  for (const [state, label] of [
    ["initializing", "等待初始化…"],
    ["starting", "正在启动"],
    ["working", "工作中…"],
  ]) {
    reason = state;
    await expect(footer).toHaveAttribute("title", label, { timeout: 15000 });
    await expect(
      footer.getByRole("img", { name: "ActivityFixture 头像" }),
    ).toBeVisible();
    assert.deepEqual(
      await footer.evaluate((e) => ({
        avatarDots: e.querySelectorAll(".rah-agent-avatar-presence").length,
        statusDots: e.querySelectorAll(".rah-live-agent-activity-dot").length,
      })),
      { avatarDots: 0, statusDots: 1 },
    );
  }
  console.log(
    "PASS Role activity projection: initializing → starting → working; zero avatar dots, one status dot (mock presence, real Role)",
  );
} finally {
  await browser.close();
  await fixture.close();
}
