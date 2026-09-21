import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await (process.env.RAH_BROWSER === "webkit" ? webkit : chromium).launch();
const failures = [];
try {
  const p = await b.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const check = async (name, run) => {
    try {
      await run();
      console.log("PASS " + name);
    } catch (e) {
      failures.push(name + ": " + e.message.slice(0, 650));
    }
  };
  const post = async (path, data) => {
    const r = await p.request.post(f.origin + "/v3/client/" + path, { data });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const w = (await post("workspaces/list", {})).workspaces[0];
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId: w.controlRoomId,
        consumerId: "mobile-chrome",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const agent = (await post("agents/list", { controlRoomId: w.controlRoomId }))
    .agents[0];
  const dm = (
    await post("rooms/direct/open", {
      workspaceId: w.workspaceId,
      peerPrincipalId: agent.definition.participantId,
      basedOnControlRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  for (const room of [f.roomId, dm.roomId]) {
    for (const surface of ["room", "search", "activity"]) {
      await check(`desktop primary ${surface} ${room}`, async () => {
        await p.setViewportSize({ width: 1440, height: 900 });
        await p.goto(
          f.origin +
            "/?" +
            new URLSearchParams(
              surface === "room" ? { room } : { surface, previewRoom: room },
            ),
        );
        const header = p.locator(".rah-conversation-head");
        await expect(header).toBeVisible();
        await expect(header.locator(".rah-search-preview-close")).toHaveCount(
          0,
        );
        await expect(header.locator(".rah-mobile-back")).toBeHidden();
        await p.setViewportSize({ width: 390, height: 844 });
        await expect(header.locator(".rah-mobile-back")).toBeVisible();
        await expect(header.locator(".rah-search-preview-close")).toHaveCount(
          0,
        );
      });
    }
  }
  await check("mobile press is pink", async () => {
    await p.goto(f.origin + "/?surface=room");
    const row = p
      .locator(".rah-room-sidebar .channel-row")
      .filter({ hasText: "History" })
      .first();
    const target = (await row.count())
      ? row
      : p.locator(".rah-room-sidebar .channel-row").first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    await p.mouse.move(box.x + 40, box.y + box.height / 2);
    await p.mouse.down();
    try {
      const pink = await target.evaluate((el) => {
        const x = document.createElement("span");
        x.style.color = "var(--pink)";
        el.append(x);
        const value = getComputedStyle(x).color;
        x.remove();
        return value;
      });
      await expect(target).toHaveCSS("background-color", pink);
    } finally {
      await p.mouse.up();
    }
  });
  for (const room of [f.roomId, dm.roomId])
    await check("single back " + room, async () => {
      await p.goto(f.origin + "/?room=" + room);
      await expect(p.locator(".rah-conversation-head")).toBeVisible();
      await expect(
        p.locator(".rah-conversation-head .rah-mobile-back"),
      ).toBeVisible();
      await expect(p.locator(".rah-search-preview-close")).toBeHidden();
    });
  await p.goto(f.origin + "/?room=" + dm.roomId);
  const composer = p.getByRole("textbox", { name: "消息输入框", exact: true });
  await composer.fill("@" + agent.handle + " Fixture reply for mobile avatar");
  await composer.press("Enter");
  const avatar = p
    .locator(".rah-message-avatar-trigger:has(.rah-agent-avatar)")
    .first();
  await expect(avatar).toBeVisible({ timeout: 30000 });
  await check("live avatar opens nonempty inspector", async () => {
    await avatar.tap();
    const panel = p.locator(".rah-agent-peek");
    await expect(panel).toBeVisible();
    await expect(panel.locator(".rah-agent-detail-head")).toBeInViewport();
    await expect(panel.locator(".rah-agent-mobile-back")).toBeVisible();
    await p.screenshot({ path: "/tmp/mobile-live-agent.png" });
    await panel.locator(".rah-agent-mobile-back").tap();
    await expect(composer).toBeVisible();
  });
  await check("avatar navigation survives repeated folding", async () => {
    for (const width of [390, 1100, 390, 1440, 390]) {
      await p.setViewportSize({ width, height: 844 });
      await avatar.click();
      const panel = p.locator(".rah-agent-peek");
      await expect(panel.locator(".rah-agent-detail-head")).toBeInViewport();
      await p.setViewportSize({ width: 390, height: 844 });
      await expect(panel.locator(".rah-agent-detail-head")).toBeInViewport();
      await panel.locator(".rah-agent-mobile-back").tap();
      await expect(composer).toBeInViewport();
    }
  });
  await p.goto(
    f.origin + "/?surface=search&q=" + encodeURIComponent(agent.handle),
  );
  await check("one search identity", async () => {
    await expect(p.locator(".rah-search-destination").first()).toBeVisible();
    await expect(
      p
        .locator(".rah-search-destination")
        .filter({ hasText: agent.currentRevision.displayName ?? agent.handle }),
    ).toHaveCount(1);
  });
  await post("agents/manage", {
    action: "set_state",
    state: "disabled",
    agentId: agent.definition.agentId,
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  await post("agents/manage", {
    action: "set_state",
    state: "tombstoned",
    agentId: agent.definition.agentId,
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  await p.goto(f.origin + "/?room=" + dm.roomId);
  await check("deleted avatar mobile back", async () => {
    await avatar.tap();
    const panel = p.locator(".rah-agent-unavailable");
    await expect(panel).toBeInViewport();
    await expect(
      panel.getByRole("button", { name: "返回聊天", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "关闭 Agent 详情", exact: true }),
    ).toBeHidden();
    await expect(panel.locator(".rah-panel-header-icon")).toHaveCSS(
      "width",
      "36px",
    );
    await p.screenshot({ path: "/tmp/mobile-unavailable-agent.png" });
    await p.setViewportSize({ width: 1440, height: 900 });
    await expect(
      panel.getByRole("button", { name: "返回聊天", exact: true }),
    ).toBeHidden();
    await expect(
      panel.getByRole("button", { name: "关闭 Agent 详情", exact: true }),
    ).toBeVisible();
    await p.setViewportSize({ width: 390, height: 844 });
    await panel.getByRole("button", { name: "返回聊天", exact: true }).tap();
    await expect(composer).toBeVisible();
  });
  console.log(JSON.stringify({ failures }));
  assert.deepEqual(failures, []);
} finally {
  await b.close();
  await f.close();
}
