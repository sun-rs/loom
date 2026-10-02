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
  const mutationRequests = [];
  page.on("request", (request) => {
    if (request.method() === "POST") {
      writes.push(request.url());
      if (/\/(roles\/revise|rooms\/(create|update))$/.test(request.url()))
        mutationRequests.push({
          url: request.url(),
          body: request.postDataJSON(),
        });
    }
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
    await page.goto(`${fixture.origin}/?surface=room&room=${fixture.roomId}`);
    if (width === 390)
      await page.getByRole("button", { name: "返回主页", exact: true }).click();
    await page.getByRole("button", { name: "新建频道", exact: true }).click();
    const createRoom = page.getByRole("dialog", {
      name: "创建频道",
      exact: true,
    });
    await createRoom
      .getByLabel("附加目录", { exact: false })
      .fill("/private/tmp");
    await createRoom
      .getByLabel("名称", { exact: false })
      .fill(`slice2-channel-${width}`);
    await expect(
      createRoom.getByRole("checkbox", {
        name: "允许实例自主创建任务",
        exact: true,
      }),
    ).not.toBeChecked();
    await createRoom
      .getByRole("checkbox", { name: "允许实例自主创建任务", exact: true })
      .check();
    await createRoom
      .getByRole("checkbox", { name: "Steer", exact: true })
      .uncheck();
    if (width === 1440) await loseCommittedResponse("rooms/create");
    await createRoom
      .getByRole("button", { name: "创建频道", exact: true })
      .click();
    if (width === 1440) {
      await expect(
        createRoom.getByLabel("名称", { exact: false }),
      ).toBeDisabled();
      await createRoom
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page.getByRole("button", { name: "聊天", exact: true }).click();
      await page.getByRole("button", { name: "新建频道", exact: true }).click();
      await expect(createRoom.getByLabel("名称", { exact: false })).toHaveValue(
        `slice2-channel-${width}`,
      );
      await createRoom
        .getByRole("button", { name: "核实创建结果", exact: true })
        .click();
    }
    await expect(createRoom).toHaveCount(0);
    const createdRooms = (
      await post("rooms/list", { workspaceId: workspace.workspaceId })
    ).rooms.filter((r) => r.name === `slice2-channel-${width}`);
    assert.equal(createdRooms.length, 1);
    const createdRoom = createdRooms[0];
    assert.equal(createdRoom.steerEnabled, false);
    assert.equal(createdRoom.allowInstanceTaskCreation, true);
    assert.deepEqual(createdRoom.channelWorkspace.additionalDirectories, [
      "/private/tmp",
    ]);
    await page
      .getByRole("button", { name: "频道详情与设置", exact: true })
      .click();
    await expect(
      page.getByText(createdRoom.channelWorkspace.primaryDirectory, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("/private/tmp", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Steer", exact: true }).check();
    await page
      .getByRole("checkbox", { name: "允许实例自主创建任务", exact: true })
      .uncheck();
    if (width === 1440) await loseCommittedResponse("rooms/update");
    await page.getByRole("button", { name: "保存更改", exact: true }).click();
    if (width === 1440) {
      await expect(
        page.getByRole("checkbox", { name: "Steer", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "核实设置结果", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "保存更改", exact: true }),
    ).toBeDisabled();
    const changed = (
      await post("rooms/list", { workspaceId: workspace.workspaceId })
    ).rooms.find((r) => r.roomId === createdRoom.roomId);
    assert.equal(changed.steerEnabled, true);
    assert.equal(changed.allowInstanceTaskCreation, false);
    await page.screenshot({
      path: `/private/tmp/loom-slice2-channel-${width}.png`,
    });
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
    if (width === 390) await page.goto(`${fixture.origin}/?surface=agents`);
    else
      await page
        .getByRole("button", { name: "Role 管理", exact: true })
        .click();
    await page
      .getByRole("button", { name: `FakeRole${width}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "编辑配置", exact: true })
      .click({ timeout: 3000 });
    const edit = page.getByRole("dialog", { name: "编辑 Role 配置" });
    await expect(edit.getByLabel("名称", { exact: false })).toHaveValue(
      `FakeRole${width}`,
    );
    await edit
      .getByLabel("角色指令", { exact: false })
      .fill("Fake revised instructions");
    if (width === 1440) await loseCommittedResponse("roles/revise");
    await edit.getByRole("button", { name: "保存修订", exact: true }).click();
    if (width === 1440) {
      await expect(edit.getByLabel("名称", { exact: false })).toBeDisabled();
      await edit.getByRole("button", { name: "取消", exact: true }).click();
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page
        .getByRole("button", { name: "Role 管理", exact: true })
        .click();
      await page
        .getByRole("button", { name: "继续核实修订", exact: true })
        .click();
      await page
        .getByRole("button", { name: "核实保存结果", exact: true })
        .click();
    }
    await expect(
      page.getByRole("dialog", { name: "编辑 Role 配置" }),
    ).toHaveCount(0);
    if (width === 1440)
      await page
        .getByRole("button", { name: `FakeRole${width}`, exact: true })
        .click();
    await expect(
      page.getByText("使用旧版本配置", { exact: false }),
    ).toBeVisible();
    const updated = await post("roles/list", {
      controlRoomId: workspace.controlRoomId,
    });
    const revised = updated.roles.find((r) => r.roleId === saved.roleId);
    assert.notEqual(revised.roleRevisionId, saved.roleRevisionId);
    assert.equal(
      revised.configuration.instructions,
      "Fake revised instructions",
    );
    assert.equal(
      updated.instances.find((i) => i.roleId === saved.roleId).roleRevisionId,
      saved.roleRevisionId,
    );
    await page.screenshot({
      path: `/private/tmp/loom-slice2-role-${width}.png`,
    });
  }
  // Same-tick duplicate submit is a race probe, separate from the real-pointer
  // desktop/mobile workflow above.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${fixture.origin}/?surface=room&room=${fixture.roomId}`);
  await page.getByRole("button", { name: "新建频道", exact: true }).click();
  const race = page.getByRole("dialog", { name: "创建频道", exact: true });
  await race.getByLabel("名称", { exact: false }).fill("slice2-race");
  await race.locator("form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(race).toHaveCount(0, { timeout: 5000 });
  assert.equal(
    (
      await post("rooms/list", { workspaceId: workspace.workspaceId })
    ).rooms.filter((r) => r.name === "slice2-race").length,
    1,
  );
  for (const path of ["roles/revise", "rooms/create", "rooms/update"]) {
    const requests = mutationRequests.filter((r) => r.url.endsWith(path));
    assert.equal(
      requests.length,
      path === "rooms/create" ? 4 : 3,
      `${path}: replay, mobile success, plus channel race probe`,
    );
    assert.deepEqual(
      requests[0].body,
      requests[1].body,
      `${path}: frozen exact request`,
    );
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
  console.log("Role revise: desktop/mobile passed (Fake CLI fixture).");
} finally {
  await browser.close();
  await fixture.close();
}
