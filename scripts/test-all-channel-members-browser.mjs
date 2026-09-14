import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture(),
  b = await chromium.launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.setDefaultTimeout(10000);
  const post = async (path, data) => {
    const r = await p.request.post(f.origin + "/v3/client/" + path, { data });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const w = (await post("workspaces/list", {})).workspaces[0];
  const sync = await post("rooms/sync", {
    roomId: w.controlRoomId,
    consumerId: "all-browser",
  });
  const room = (
    await post("rooms/create", {
      workspaceId: w.workspaceId,
      basedOnControlRoomSeq: sync.latestRoomSeq,
      kind: "channel",
      name: "all",
      slug: "all",
      visibility: "public",
      idempotencyKey: "fixture-all",
    })
  ).room;
  await p.goto(f.origin + "/?room=" + room.roomId);
  await p.getByRole("button", { name: "频道详情与设置", exact: true }).click();
  assert.equal(
    await p.getByRole("button", { name: "添加成员", exact: true }).count(),
    0,
    "all has no add affordance",
  );
  await p.getByRole("button", { name: "管理成员", exact: true }).click();
  assert.equal(
    await p.getByRole("button", { name: "添加成员", exact: true }).count(),
    0,
  );
  assert.equal(await p.getByRole("button", { name: /移除/ }).count(), 0);
  await p.screenshot({ path: "/tmp/rah-all-members.png" });
  await p.reload();
  await p.getByRole("button", { name: "频道详情与设置", exact: true }).click();
  assert.match(
    await p.getByRole("button", { name: "管理成员", exact: true }).innerText(),
    /2 个 Agent/,
  );
  const operationSizes = await p
    .locator(".rah-channel-settings-operations .btn")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        font: getComputedStyle(button).fontSize,
        icon: getComputedStyle(button.querySelector("svg")).width,
      })),
    );
  assert.deepEqual(operationSizes, [
    { font: "16px", icon: "16px" },
    { font: "16px", icon: "16px" },
  ]);
  await p.locator(".rah-channel-settings-operations").screenshot({
    path: "/tmp/rah-channel-operation-sizes-desktop.png",
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator(".rah-channel-settings-operations").scrollIntoViewIfNeeded();
  for (const name of ["隐藏 #all", "停止 Agent"]) {
    const button = p.getByRole("button", { name, exact: true });
    assert.equal(
      await button.evaluate((el) => getComputedStyle(el).fontSize),
      "16px",
    );
    const box = await button.boundingBox();
    assert.ok(box.width >= 200 && box.height >= 44);
  }
  await p.locator(".rah-channel-settings-operations").screenshot({
    path: "/tmp/rah-channel-operation-sizes-mobile.png",
  });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.getByRole("button", { name: "隐藏 #all", exact: true }).click();
  const confirm = p.getByRole("dialog", { name: "隐藏 #ALL", exact: true });
  await confirm.waitFor();
  const cb = await confirm.boundingBox();
  assert.equal(cb.width, 384);
  assert.ok(Math.abs(cb.x + cb.width / 2 - 720) <= 1);
  const cancelBox = await confirm
    .getByRole("button", { name: "取消", exact: true })
    .boundingBox();
  const hideBox = await confirm
    .getByRole("button", { name: "隐藏 #all", exact: true })
    .boundingBox();
  assert.equal(cancelBox.y, hideBox.y);
  await p.screenshot({ path: "/tmp/rah-hide-all-confirm.png" });
  await confirm.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(
    (
      await post("workspaces/system-channel/read", {
        workspaceId: w.workspaceId,
      })
    ).hidden,
    false,
  );
  await p.getByRole("button", { name: "隐藏 #all", exact: true }).click();
  await confirm.getByRole("button", { name: "隐藏 #all", exact: true }).click();
  await confirm.waitFor({ state: "hidden" });
  assert.equal(
    (
      await post("workspaces/system-channel/read", {
        workspaceId: w.workspaceId,
      })
    ).hidden,
    true,
  );
  await p.waitForFunction(
    () =>
      ![...document.querySelectorAll(".rah-room-sidebar .channel-row")].some(
        (e) => e.textContent.trim() === "all",
      ),
    undefined,
    { timeout: 2000 },
  );
  const denied = await p.request.post(f.origin + "/v3/client/rooms/sync", {
    data: { roomId: room.roomId, consumerId: "hidden-browser" },
  });
  assert.notEqual(denied.status(), 200);
  await p.goto(f.origin + "/?surface=settings&settingsSection=administration");
  const checkbox = p.getByRole("checkbox", { name: "隐藏 #all 频道" });
  await checkbox.waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-system-channel-card input")?.checked ===
      true,
  );
  const saveButton = p
    .locator(".rah-system-channel-card")
    .getByRole("button", { name: "保存", exact: true });
  const saveGeometry = await saveButton.evaluate((e) => {
    const s = getComputedStyle(e);
    return {
      font: s.fontSize,
      line: s.lineHeight,
      top: s.paddingTop,
      left: s.paddingLeft,
      height: e.getBoundingClientRect().height,
    };
  });
  assert.deepEqual(saveGeometry, {
    font: "12px",
    line: "16px",
    top: "6px",
    left: "12px",
    height: 32,
  });
  await checkbox.uncheck();
  await Promise.all([
    p.waitForResponse(
      (r) =>
        r.url().endsWith("/v3/client/workspaces/system-channel/update") &&
        r.status() === 200,
    ),
    p
      .locator(".rah-system-channel-card")
      .getByRole("button", { name: "保存", exact: true })
      .click(),
  ]);
  await p.waitForFunction(
    () =>
      document.querySelector(".rah-system-channel-card button")?.disabled ===
      true,
  );
  assert.equal(
    (
      await post("workspaces/system-channel/read", {
        workspaceId: w.workspaceId,
      })
    ).hidden,
    false,
  );
  await p
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "聊天", exact: true })
    .click();
  await p.waitForFunction(() =>
    [...document.querySelectorAll(".rah-room-sidebar .channel-row")].some(
      (e) => e.textContent.trim() === "all",
    ),
  );
  await p.goto(f.origin + "/?surface=settings&settingsSection=administration");
  await checkbox.waitFor();
  assert.equal(await checkbox.isChecked(), false);
  await p.screenshot({ path: "/tmp/rah-system-channel-settings.png" });
  console.log(
    "all includes fixture Agents, no add/remove controls, reload passed",
  );
} finally {
  await b.close();
  await f.close();
}
