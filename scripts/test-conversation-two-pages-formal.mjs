// Read-only acceptance against an explicitly selected formal workbench.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { chromium, expect } from "playwright/test";
import {
  classifyFormalBrowserRequest,
  parseFormalBrowserTarget,
} from "./formal-browser-request-policy.mjs";
const { origin, databasePath: state } = parseFormalBrowserTarget(process.env);
const roomId = process.env.RAH_FORMAL_ROOM_ID,
  dmId = process.env.RAH_FORMAL_DM_ID;
assert.ok(
  roomId && dmId,
  "Choose existing Room with Tasks and DM with Human/Agent messages",
);
function snapshot() {
  const db = new DatabaseSync(state, { readOnly: true });
  try {
    return Object.fromEntries(
      ["messages", "tasks", "room_events", "agent_definitions"].map((t) => [
        t,
        db.prepare(`SELECT count(*) n FROM ${t}`).get().n,
      ]),
    );
  } finally {
    db.close();
  }
}
const before = snapshot();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  serviceWorkers: "block",
  viewport: { width: 1920, height: 1000 },
});
const blocked = [],
  errors = [];
await context.route("**/*", async (route) => {
  const r = route.request();
  const url = new URL(r.url());
  // Published profile images are authenticated GET reads, never configuration writes.
  if (
    r.method() === "GET" &&
    url.origin === origin &&
    url.pathname.startsWith("/v3/client/profile-images/content/")
  )
    return route.continue();
  if (
    r.method() === "POST" &&
    url.origin === origin &&
    url.pathname === "/v3/client/agents/trajectory/list"
  )
    return route.continue();
  const c = classifyFormalBrowserRequest({
    method: r.method(),
    url: r.url(),
    origin,
  });
  if (c.decision === "reject") {
    blocked.push(c.identity);
    return route.abort();
  }
  return route.continue();
});
const p = await context.newPage();
p.setDefaultTimeout(12000);
p.on("pageerror", (e) => errors.push(String(e)));
const room = p.locator(".rah-product-shell > .channel:not(.rah-agent-peek)");
const thread = p.getByTestId("thread-side-column");
const profile = p.locator(".rah-agent-peek");
const shot = async (name) => {
  await p.mouse.move(5, 5);
  await p.screenshot({
    path: "/tmp/rah-two-pages-formal-" + name + ".png",
    animations: "disabled",
  });
};
const openThread = async (avatar) => {
  const msg = avatar.locator("xpath=..");
  await msg.hover();
  await msg
    .getByRole("button", { name: "在消息列中回复", exact: true })
    .click();
  await expect(thread).toBeVisible();
};
const closeProfile = async () => {
  await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
};
try {
  for (const [kind, id] of [
    ["room", roomId],
    ["dm", dmId],
  ]) {
    await p.setViewportSize({ width: 1920, height: 1000 });
    await p.goto(origin + "/?room=" + id);
    await expect(room).toBeVisible();
    const a = room
      .locator('.rah-message-avatar-trigger[aria-label$="动态"]')
      .first();
    await expect(a).toBeVisible();
    await openThread(a);
    const w = (await thread.boundingBox()).width;
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="动态"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(room).toBeHidden();
    await expect(thread).toBeVisible();
    assert.ok(Math.abs((await profile.boundingBox()).width - w) < 1);
    await shot(kind + "-thread-agent");
    await closeProfile();
    await expect(room).toBeVisible();
    await expect(thread).toBeVisible();
    await a.click();
    await expect(room).toBeVisible();
    await expect(thread).toBeHidden();
    await expect(profile).toBeVisible();
    await shot(kind + "-room-agent");
    await openThread(a);
    await expect(profile).toBeHidden();
    await expect(room).toBeVisible();
    if (kind === "room") {
      const rb = await room.boundingBox(),
        tb = await thread.boundingBox();
      await room
        .getByRole("button", { name: "频道详情与设置", exact: true })
        .click();
      await expect(p.locator(".rah-channel-settings-drawer")).toBeVisible();
      assert.deepEqual(await room.boundingBox(), rb);
      assert.deepEqual(await thread.boundingBox(), tb);
      await shot("room-settings-overlay");
      await p.keyboard.press("Escape");
    }
    await thread.locator(".rah-thread-close").click();
    const h = room
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first();
    await expect(h).toBeVisible();
    await openThread(h);
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(room).toBeHidden();
    for (const width of [2560, 1200, 900, 390]) {
      await p.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect(profile).toBeVisible();
      if (width >= 1200) await expect(thread).toBeVisible();
      else await expect(thread).toBeHidden();
      if (width === 390)
        assert.ok(Math.abs((await profile.boundingBox()).width - width) < 2);
      await shot(kind + "-human-" + width);
    }
    await closeProfile();
    await expect(thread).toBeVisible();
    assert.ok(
      Math.abs((await thread.boundingBox()).width - 390) < 2,
      "restored Thread fills mobile",
    );
    await thread.locator(".rah-thread-back").click();
    await expect(room).toBeVisible();
    assert.ok(
      Math.abs((await room.boundingBox()).width - 390) < 2,
      "restored Room fills mobile",
    );
    await room
      .locator('.rah-message-avatar-trigger[aria-label$="动态"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(room).toBeHidden();
    await shot(kind + "-agent-mobile");
    await closeProfile();
    await p.reload();
    await expect(room).toBeVisible();
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(origin + "/?room=" + roomId);
  await room.getByRole("tab", { name: "任务", exact: true }).click();
  await room.locator(".rah-global-card-open").first().click();
  await expect(thread).toBeVisible();
  await thread.locator(".rah-message-avatar-trigger").first().click();
  await expect(profile).toBeVisible();
  await expect(room).toBeHidden();
  await expect(thread).toBeVisible();
  await shot("room-task-person");
  await closeProfile();
  await expect(
    room.getByRole("tab", { name: "任务", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  for (const width of [1440, 390]) {
    await p.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await p.goto(origin + "/?surface=tasks");
    await p.locator(".rah-global-card-open").first().click();
    const modal = p.getByTestId("task-thread-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".msg").first()).toBeVisible();
    await shot("task-modal-" + width);
    await modal
      .getByRole("button", { name: "关闭任务详情", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
  }
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(snapshot(), before);
  const build = JSON.parse(
    readFileSync(
      new URL(
        "../apps/web/dist-workbench/.rah-web-build.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).webBuildId;
  assert.ok((await (await fetch(origin)).text()).includes(build));
  console.log(
    JSON.stringify({
      result: "passed",
      build,
      canonicalCounts: before,
      blocked,
      errors,
      coverage:
        "formal Room/DM Agent/Human, Task board/modal, overlay, 2560/1920/1440/1200/900/390, replacement, return, reload",
    }),
  );
} finally {
  await browser.close();
}
