// Temporary real Kernel + Fake CLI only. No paid providers or formal state.
import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const writes = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  const post = async (path, data) => {
    const result = await page.request.post(
      `${fixture.origin}/v3/client/${path}`,
      { data },
    );
    assert.equal(result.status(), 200, await result.text());
    return result.json();
  };
  const loseCommittedResponse = async (path) => {
    await page.route(
      `**/v3/client/${path}`,
      async (route) => {
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        await route.abort("failed");
      },
      { times: 1 },
    );
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  // The old shell fixture seeds channel_home metadata without an allocator.
  // Create through the running daemon so the channel has its real ownership
  // receipt, as in production; never fabricate workspace rows for this test.
  const head = await post("rooms/sync", {
    roomId: workspace.controlRoomId,
    consumerId: "role-gate",
    bootstrap: "latest",
  });
  const targetRoom = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: head.latestRoomSeq,
      idempotencyKey: crypto.randomUUID(),
      kind: "channel",
      name: "Fake Role Gate",
      slug: "fake-role-gate",
      visibility: "public",
    })
  ).room;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${fixture.origin}/?surface=agents`);
    await page.getByRole("button", { name: "创建 Role", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建 Role" });
    await dialog.getByLabel("名称", { exact: false }).fill(`FakeRole${width}`);
    await dialog
      .getByRole("button", { name: "运行时：请选择", exact: true })
      .click();
    await page.getByRole("menuitemradio").first().click();
    await dialog
      .getByRole("button", { name: "模型：请选择", exact: true })
      .click();
    await page.getByRole("menuitemradio").first().click();
    await dialog
      .getByRole("button", { name: "推理强度：默认", exact: true })
      .click();
    await page.getByRole("menuitemradio", { name: /^Low/ }).click();
    if (width === 1440) await loseCommittedResponse("roles/create");
    await dialog
      .getByRole("button", { name: "保存 Role", exact: true })
      .click();
    if (width === 1440) {
      await expect(dialog.getByLabel("名称", { exact: false })).toBeDisabled();
      await dialog
        .getByRole("button", { name: "核实保存结果", exact: true })
        .click();
    }
    await expect(dialog).toHaveCount(0);
    const role = page.getByRole("button", {
      name: `FakeRole${width}`,
      exact: true,
    });
    await role.click();
    await page
      .getByRole("button", { name: "加入频道：请选择", exact: true })
      .click();
    const channelName = (
      await post("rooms/list", { workspaceId: workspace.workspaceId })
    ).rooms.find((room) => room.roomId === targetRoom.roomId).name;
    await page
      .getByRole("menuitemradio", { name: channelName, exact: true })
      .click();
    await page.screenshot({
      path: `/private/tmp/loom-role-profile-${width}.png`,
    });
    const create = page.getByRole("button", {
      name: "创建实例并打开频道",
      exact: true,
    });
    const box = await create.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0);
    // Real pointer, exercises overlay and mobile hit targets.
    if (width === 1440) await loseCommittedResponse("roles/instantiate");
    await create.click();
    if (width === 1440) {
      await expect(
        page.getByRole("button", { name: "核实创建结果", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page
        .getByRole("button", { name: "Role 管理", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: `FakeRole${width}`, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "核实创建结果", exact: true })
        .click();
    }
    await expect(page.locator(".rah-conversation-head")).toBeVisible();
    const catalog = await post("roles/list", {
      controlRoomId: workspace.controlRoomId,
    });
    const saved = catalog.roles.find(
      (r) => r.configuration.displayName === `FakeRole${width}`,
    );
    assert.ok(saved);
    assert.equal(
      catalog.roles.filter(
        (r) => r.configuration.displayName === `FakeRole${width}`,
      ).length,
      1,
    );
    assert.equal(
      catalog.instances.filter(
        (i) => i.roleId === saved.roleId && i.channelId === targetRoom.roomId,
      ).length,
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const composer = page.locator(
      'textarea[aria-label="消息输入框"]:not(:disabled)',
    );
    await composer.fill(`FAKE frontend message ${width}`);
    await composer.press("Enter");
    await expect(
      page.getByText(`FAKE frontend message ${width}`, { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText(new RegExp(`Fake CLI.*FAKE frontend message ${width}`))
        .first(),
    ).toBeVisible({ timeout: 30000 });
    await page.screenshot({
      path: `/private/tmp/loom-role-first-slice-${width}.png`,
    });
  }
  assert.ok(writes.some((url) => url.includes("/roles/create")));
  assert.ok(writes.some((url) => url.includes("/roles/instantiate")));
  assert.equal(
    writes.some(
      (url) =>
        url.includes("/agents/provision") || url.includes("/members/add"),
    ),
    false,
  );
  console.log(
    "Role save → new channel instance → conversation: desktop/mobile passed (Fake CLI).",
  );
} finally {
  await browser.close();
  await fixture.close();
}
