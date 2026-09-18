import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { chromium, expect } from "playwright/test";
import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";
const { origin, databasePath } = parseFormalBrowserTarget(process.env);
const db = new DatabaseSync(databasePath, { readOnly: true });
const snapshot = () =>
  db
    .prepare(
      "SELECT room_id,max(room_seq) seq FROM room_events GROUP BY room_id ORDER BY room_id",
    )
    .all();
const before = snapshot();
const agent = db
  .prepare(
    "SELECT agent_definition_id FROM agent_definitions WHERE state <> 'tombstoned' ORDER BY created_at LIMIT 1",
  )
  .get();
const browser = await chromium.launch();
const errors = [],
  rejected = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const extraReads = [
        "/v3/client/agents/rooms/list",
        "/v3/client/agents/trajectory/list",
      ];
      if (
        url.origin === origin &&
        request.method() === "POST" &&
        extraReads.includes(url.pathname)
      )
        return route.continue();
      const decision = classifyFormalBrowserRequest({
        method: request.method(),
        url: request.url(),
        origin,
      });
      if (decision.decision === "reject") {
        rejected.push(decision.identity);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?surface=settings&settingsSection=appearance`);
    const hidden = page
      .locator(".rah-settings-card")
      .filter({ has: page.locator("#rah-hide-empty-label") });
    await hidden.waitFor();
    await hidden.scrollIntoViewIfNeeded();
    assert.equal(
      await hidden.evaluate(
        (e) =>
          e.previousElementSibling.querySelector("#rah-agent-model-label") !==
          null,
      ),
      true,
    );
    assert.equal(
      await hidden.evaluate((e) =>
        Math.round(
          e.getBoundingClientRect().top -
            e.previousElementSibling.getBoundingClientRect().bottom,
        ),
      ),
      16,
    );
    assert.equal(
      await page
        .locator(".rah-settings-navigation")
        .getByRole("button", { name: "计算机", exact: true })
        .count(),
      0,
    );
    await page.screenshot({ path: `/tmp/rah-settings-formal-${width}.png` });
    if (agent) {
      await page.goto(
        `${origin}/?surface=agents&agent=${encodeURIComponent(agent.agent_definition_id)}&agentTab=chat`,
      );
      const pane = page.locator(".rah-agent-chat-pane");
      await pane.waitFor();
      await page.evaluate(() => document.fonts.ready);
      const tabPadding = await page
        .locator(".rah-agent-detail-tabs .tab")
        .evaluateAll((tabs) =>
          tabs.map((tab) => {
            const range = document.createRange();
            range.selectNodeContents(tab.lastChild);
            const box = tab.getBoundingClientRect();
            return [
              tab.querySelector("svg").getBoundingClientRect().left - box.left,
              box.right - range.getBoundingClientRect().right,
            ];
          }),
        );
      assert.ok(tabPadding.length > 0);
      for (const padding of tabPadding) {
        for (const value of padding) assert.ok(Math.abs(value - 16) < 0.1);
      }
      await expect(pane.locator(".rah-agent-chat-status")).toHaveCount(0);
      assert.equal(await pane.locator(".rah-agent-chat-compose").count(), 0);
      await expect(pane.locator(".rah-inline-error")).toHaveCount(0);
      const rows = await pane
        .locator(".rah-agent-chat-room-list button")
        .evaluateAll((es) =>
          es.map((e) => ({
            name: e.querySelector("b").textContent,
            label: e.querySelector("i").textContent,
            icon: e.querySelector("use").getAttribute("href"),
          })),
        );
      assert.ok(rows.length > 0);
      for (const row of rows) {
        const room = db
          .prepare("SELECT kind,visibility FROM rooms WHERE name=?")
          .get(row.name);
        assert.ok(room);
        assert.equal(
          row.label,
          room.kind === "direct"
            ? "私信"
            : room.visibility === "private"
              ? "私有"
              : "公开",
        );
        assert.ok(
          row.icon.endsWith(
            room.kind === "direct" || room.visibility === "private"
              ? "-icon-lock"
              : "-icon-hash",
          ),
        );
      }
      await page.screenshot({
        path: `/tmp/rah-agent-chat-formal-${width}.png`,
      });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(rejected, []);
  assert.deepEqual(
    snapshot(),
    before,
    "formal verification must not mutate Room events",
  );
  console.log(
    "Formal Settings and Agent chat passed at 1440px and 390px; no Room mutation.",
  );
} finally {
  await browser.close();
  db.close();
}
