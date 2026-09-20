import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await p.addInitScript(() => {
    const Native = window.ResizeObserver;
    window.__shellObservations = 0;
    window.ResizeObserver = class extends Native {
      observe(target, options) {
        if (target.hasAttribute("data-conversation-shell"))
          window.__shellObservations++;
        return super.observe(target, options);
      }
    };
  });
  // Test-only render counter; the served module otherwise remains unchanged.
  await p.route("**/src/App.tsx", async (route) => {
    const response = await route.fetch(),
      body = await response.text();
    assert.ok(body.includes("useDefaultWebPush(client);"));
    await route.fulfill({
      response,
      body: body.replace(
        "useDefaultWebPush(client);",
        "window.__workspaceRenders = (window.__workspaceRenders || 0) + 1; useDefaultWebPush(client);",
      ),
    });
  });
  for (const surface of ["search", "activity", "room"]) {
    await p.setViewportSize({ width: 1600, height: 900 });
    await p.goto(
      f.origin +
        "/?" +
        new URLSearchParams({
          surface,
          room: f.roomId,
          ...(surface === "room" ? {} : { previewRoom: f.roomId }),
          q: "History",
        }),
    );
    if (surface === "search")
      await expect(p.locator(".rah-search-hit").first()).toBeVisible();
    await expect(p.locator(".rah-conversation-head")).toBeVisible();
    await p.waitForTimeout(700);
    const count = () => p.evaluate(() => window.__workspaceRenders);
    assert.ok((await count()) > 0);
    const observations = await p.evaluate(() => window.__shellObservations);
    let start = await count();
    for (let i = 0; i < 40; i++)
      await p.setViewportSize({ width: 1600 - i * 4, height: 900 });
    const resize = (await count()) - start;
    const separator = p.getByRole("separator", {
      name:
        surface === "search"
          ? "调整搜索结果宽度"
          : surface === "activity"
            ? "调整动态列表宽度"
            : "调整聊天边栏宽度",
      exact: true,
    });
    const box = await separator.boundingBox();
    start = await count();
    await p.mouse.move(box.x + box.width / 2, box.y + 150);
    await p.mouse.down();
    await p.mouse.move(box.x - 100, box.y + 150, { steps: 40 });
    await p.mouse.up();
    const drag = (await count()) - start;
    console.log(
      JSON.stringify({
        surface,
        resizeWorkspaceRenders: resize,
        dragWorkspaceRenders: drag,
      }),
    );
    assert.ok(
      resize <= 8,
      `continuous resize rerendered Workspace ${resize} times`,
    );
    assert.ok(drag <= 8, `continuous drag rerendered Workspace ${drag} times`);
    assert.equal(
      await p.evaluate(() => window.__shellObservations),
      observations,
      "width changes must not recreate the shell observer",
    );
    const saved = await p.evaluate(
      (key) => localStorage.getItem(key),
      surface === "room" ? "rah:room-sidebar-width" : `rah:${surface}-width`,
    );
    assert.ok(Number(saved) < (surface === "room" ? 240 : 560));
    await p.reload();
    await expect(separator).toHaveAttribute("aria-valuenow", saved);
    console.log(
      "PASS isolated width renders, real pointer drag, persistence and reload",
    );
  }
} finally {
  await b.close();
  await f.close();
}
