import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_PRESENCE_PROBE = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${fixture.origin}/?surface=room`, {
      waitUntil: "networkidle",
    });
    const pinned = page.locator(
      '[data-sidebar-group="pinned"] .rah-sidebar-disclosure',
    );
    const channels = page.locator(
      '[data-sidebar-group="channels"] .rah-sidebar-disclosure',
    );
    await expect(pinned).toHaveAttribute("aria-expanded", "false");
    await expect(channels).toHaveAttribute("aria-expanded", "true");
    await pinned.click();
    await channels.click();
    await page.reload({ waitUntil: "networkidle" });
    await expect(pinned).toHaveAttribute("aria-expanded", "true");
    await expect(channels).toHaveAttribute("aria-expanded", "false");
    const appearance = `${fixture.origin}/?surface=settings&settingsSection=appearance`;
    await page.goto(appearance, { waitUntil: "networkidle" });
    const hide = page.getByRole("checkbox", {
      name: "隐藏空的侧栏分区",
      exact: true,
    });
    await expect(hide).not.toBeChecked();
    await hide.check();
    await page.goto(`${fixture.origin}/?surface=room`, {
      waitUntil: "networkidle",
    });
    await expect(channels).toBeVisible();
    await expect(pinned).toBeHidden();
    await expect(page.locator('[data-sidebar-group="pinned"]')).toBeHidden();
    await expect(channels).toBeVisible();
    await page.goto(appearance, { waitUntil: "networkidle" });
    await expect(hide).toBeChecked();
    await hide.uncheck();
    await page.goto(`${fixture.origin}/?surface=room`, {
      waitUntil: "networkidle",
    });
    await expect(pinned).toHaveAttribute("aria-expanded", "true");
    await expect(channels).toHaveAttribute("aria-expanded", "false");
    // Change only the observed process identity: same durable preferences/data.
    await page.route("**/v1/local/runtimes/list", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.computer.instanceId = "FAKE-restarted-host";
      await route.fulfill({ response, json: body });
    });
    await page.reload({ waitUntil: "networkidle" });
    await expect(pinned).toHaveAttribute("aria-expanded", "false");
    await expect(channels).toHaveAttribute("aria-expanded", "true");
    await page.unroute("**/v1/local/runtimes/list");
    if (width === 390) {
      const post = async (path, data) => {
        const r = await page.request.post(
          `${fixture.origin}/v3/client/${path}`,
          { data },
        );
        assert.equal(r.status(), 200, await r.text());
        return r.json();
      };
      const workspace = (await post("workspaces/list", {})).workspaces[0];
      const channelRows = page.locator(
        '[data-sidebar-group="channels"] .channel-row',
      );
      const originalCount = await channelRows.count();
      for (let i = 0; i < 24; i++) {
        const sync = await post("rooms/sync", {
          roomId: workspace.controlRoomId,
          consumerId: "activity-pill-test",
        });
        await post("rooms/create", {
          workspaceId: workspace.workspaceId,
          basedOnControlRoomSeq: sync.latestRoomSeq,
          kind: "channel",
          name: `Pill fixture ${i}`,
          slug: `pill-fixture-${i}`,
          visibility: "public",
          idempotencyKey: `pill-room-${i}`,
        });
      }
      await page.reload({ waitUntil: "networkidle" });
      await expect(channelRows).toHaveCount(originalCount + 24);
      const members = (
        await post("rooms/agents/activity/list", { roomId: fixture.roomId })
      ).agents;
      const latestRoomSeq = (
        await post("rooms/sync", {
          roomId: fixture.roomId,
          consumerId: "activity-pill-test",
        })
      ).latestRoomSeq;
      await post("messages/post", {
        roomId: fixture.roomId,
        body: "[presence-probe]",
        recipients: [
          { participantId: members[0].participantId, reason: "mention" },
        ],
        basedOnRoomSeq: latestRoomSeq,
        idempotencyKey: crypto.randomUUID(),
      });
      const pill = page.getByTestId("live-agent-activity-bar");
      await expect(pill).toBeVisible({ timeout: 30000 });
      const nav = page.getByRole("navigation", { name: "移动端主导航" });
      const box = await pill.boundingBox(),
        bottom = await nav.boundingBox();
      assert.ok(
        box.y + box.height <= bottom.y - 6,
        "activity pill clears the floating navigation",
      );
      assert.ok(
        box.height <= 36 && box.width <= width - 32,
        "activity is a compact inset pill",
      );
      await expect(pill).toHaveCSS("position", "fixed");
      await page.locator(".sidebar-body").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      assert.ok(
        await page.locator(".sidebar-body").evaluate((el) => el.scrollTop > 0),
        "fixture genuinely scrolls",
      );
      const target = await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest('[data-testid="live-agent-activity-bar"]') !== null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      assert.equal(
        target,
        true,
        "activity pill stays above the scrolling list",
      );
      assert.deepEqual(
        await pill.boundingBox(),
        box,
        "list scrolling cannot move the activity pill",
      );
      await page.screenshot({
        path: `/tmp/rah-sidebar-activity-pill-${process.env.RAH_UI_BROWSER ?? "chromium"}.png`,
      });
      await page.goto(appearance, { waitUntil: "networkidle" });
      await page
        .getByRole("checkbox", { name: "实时 Agent 动态", exact: true })
        .uncheck();
      await page.goto(`${fixture.origin}/?surface=room`, {
        waitUntil: "networkidle",
      });
      await expect(pill).toBeHidden();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "PASS sidebar preferences, host restart scope and mobile activity pill",
  );
} finally {
  await browser.close();
  await fixture.close();
}
