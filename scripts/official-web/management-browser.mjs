import { verifySidebarInteractions } from "./sidebar-interactions-browser.mjs";
// FIXTURE ONLY: real Core with fake runtime discovery; no paid execution.
import assert from "node:assert/strict";
export async function verifyManagement({
  browser,
  origin,
  client,
  workspace,
  channel,
  offer,
}) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(`${origin}/?view=agents&room=${channel.roomId}`);
    await page.getByTestId("loom-role-list").waitFor();
    assert.equal(
      await page.getByRole("button", { name: "角色", exact: true }).count(),
      0,
    );
    await page.getByRole("button", { name: "新建角色", exact: true }).click();
    let dialog = page.getByRole("dialog");
    const name = `BrowserRole${viewport.width}`;
    await dialog.getByLabel("名称", { exact: true }).fill(name);
    await dialog
      .getByLabel("角色 Prompt", { exact: true })
      .fill("FIXTURE ONLY do not execute");
    await dialog
      .getByLabel("CLI", { exact: true })
      .selectOption(offer.runtimeOfferId);
    await dialog
      .getByLabel("模型", { exact: true })
      .selectOption(offer.modelBindingDescriptors[0].modelBindingId);
    const requests = [];
    let lost = false;
    await page.route("**/v3/client/roles/create", async (route) => {
      requests.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "保存角色", exact: true }).click();
    await dialog.getByRole("button", { name: "核实操作结果" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(requests[0], requests[1]);
    let catalog = await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    });
    const role = catalog.roles.find(
      (r) => r.configuration.displayName === name,
    );
    assert.ok(role);
    assert.equal(
      catalog.roles.filter((r) => r.configuration.displayName === name).length,
      1,
    );
    await page.locator(`[data-role-id="${role.roleId}"]`).click();
    const detail = page.getByTestId("loom-role-detail");
    await detail.getByLabel("名称", { exact: true }).fill(`${name}Edited`);
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/roles/revise") && r.status() === 200,
      ),
      detail.getByRole("button", { name: "保存角色", exact: true }).click(),
    ]);
    await page
      .getByRole("button", { name: `更多操作 ${name}Edited`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "添加实例到频道", exact: true })
      .click();
    await dialog
      .getByLabel("频道", { exact: true })
      .selectOption(channel.roomId);
    await dialog.getByRole("button", { name: "确认添加", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    catalog = await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    });
    const instance = catalog.instances.find((i) => i.roleId === role.roleId);
    assert.ok(instance);
    const agent = (
      await client.request("agent.get", { agentId: instance.agentId })
    ).agent;
    const instanceName = agent.currentRevision.displayName ?? agent.handle;
    await page.getByRole("tab", { name: "实例", exact: true }).click();
    // Only this role's single instance is offered, although the fixture has other roles.
    assert.equal(
      await detail.getByRole("button", { name: /^更多操作 / }).count(),
      2,
    );

    await page
      .getByRole("button", { name: `更多操作 ${instanceName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "重启实例", exact: true }).click();
    assert.equal(
      await dialog.getByLabel("重启配置", { exact: true }).inputValue(),
      "keep",
    );
    await dialog.getByRole("button", { name: "确认重启", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    // Editing a Role must leave the instance snapshot frozen until explicit adoption.
    const frozenRevision = instance.roleRevisionId;
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await detail
      .getByLabel("角色 Prompt", { exact: true })
      .fill("FIXTURE revised prompt; never execute");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/roles/revise") && r.status() === 200,
      ),
      detail.getByRole("button", { name: "保存角色", exact: true }).click(),
    ]);
    let revised = await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    });
    const latest = revised.roles.find((r) => r.roleId === role.roleId);
    assert.notEqual(latest.roleRevisionId, frozenRevision);
    assert.equal(
      revised.instances.find((i) => i.instanceId === instance.instanceId)
        .roleRevisionId,
      frozenRevision,
    );
    await page.getByRole("tab", { name: "实例", exact: true }).click();
    await page
      .getByRole("button", { name: `更多操作 ${instanceName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "重启实例", exact: true }).click();
    await dialog
      .getByLabel("重启配置", { exact: true })
      .selectOption(latest.roleRevisionId);
    await dialog.getByRole("button", { name: "确认重启", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    revised = await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    });
    assert.equal(
      revised.instances.find((i) => i.instanceId === instance.instanceId)
        .roleRevisionId,
      latest.roleRevisionId,
    );

    // Opening a private box from Agent keeps unknown-result recovery visible on this page.
    let privateLost = false;
    await page.route("**/v3/client/rooms/direct/open", async (route) => {
      if (!privateLost) {
        privateLost = true;
        await route.abort();
      } else await route.continue();
    });
    await page
      .getByRole("button", { name: `更多操作 ${instanceName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "打开私聊", exact: true }).click();
    await page
      .getByRole("button", { name: "核实打开私聊", exact: true })
      .click();
    await page
      .getByRole("heading", { name: `私聊 · ${instanceName}`, exact: true })
      .waitFor();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "Agent", exact: true })
      .click();
    await page.getByRole("tab", { name: "配置", exact: true }).click();
    await page
      .getByRole("button", { name: `更多操作 ${name}Edited`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除角色", exact: true }).click();
    await dialog
      .getByRole("button", { name: "确认删除角色", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    catalog = await client.request("role.list", {
      controlRoomId: workspace.controlRoomId,
    });
    assert.equal(
      catalog.roles.some((r) => r.roleId === role.roleId),
      false,
    );
    assert.ok(
      catalog.instances.some((i) => i.instanceId === instance.instanceId),
    );
    await page.getByRole("tab", { name: "实例", exact: true }).click();
    await page
      .getByRole("button", { name: `更多操作 ${instanceName}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "移除实例", exact: true }).click();
    await dialog.getByRole("button", { name: "确认移除", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      (
        await client.request("role.list", {
          controlRoomId: workspace.controlRoomId,
        })
      ).instances.some((i) => i.instanceId === instance.instanceId),
      false,
    );
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "频道", exact: true })
      .click();
    await verifySidebarInteractions(page);
    assert.equal(
      await page.getByRole("button", { name: /频道操作/ }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "新建频道", exact: true })
      .first()
      .click();
    const channelName = `BrowserChannel${viewport.width}`;
    await dialog.getByLabel("名称", { exact: true }).fill(channelName);
    await dialog.getByRole("button", { name: "创建频道", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const created = (
      await client.request("room.list", { workspaceId: workspace.workspaceId })
    ).rooms.find((r) => r.name === channelName);
    assert.ok(created);
    await page
      .locator('[data-sidebar-section="channels"]')
      .getByRole("button", { name: "频道", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "新建分组", exact: true }).click();
    const groupName = `BrowserGroup${viewport.width}`;
    await dialog.getByLabel("名称", { exact: true }).fill(groupName);
    await dialog.getByRole("button", { name: "保存分组", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .locator(`[data-public-channel-id="${created.roomId}"]`)
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "移动到分区", exact: true })
      .click();
    await page.getByRole("menuitem", { name: groupName, exact: true }).click();
    await page
      .locator(`[data-public-channel-id="${created.roomId}"]`)
      .click({ button: "right" });
    const sidebarRequests = [];
    let sidebarLost = false;
    await page.route("**/v3/client/sidebar/patch", async (route) => {
      sidebarRequests.push(route.request().postDataJSON());
      if (!sidebarLost) {
        sidebarLost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
    await page
      .getByRole("button", { name: "核实操作结果", exact: true })
      .click();
    await page
      .locator(
        `[data-sidebar-section="pinned"] [data-public-channel-id="${created.roomId}"]`,
      )
      .waitFor();
    assert.deepEqual(sidebarRequests[0], sidebarRequests[1]);
    await page.unroute("**/v3/client/sidebar/patch");
    await page.reload();
    await page
      .locator(
        `[data-sidebar-section="pinned"] [data-public-channel-id="${created.roomId}"]`,
      )
      .waitFor();
    const preferences = (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences;
    assert.ok(preferences.pinned.includes(`room:${created.roomId}`));
    assert.ok(
      preferences.customSections
        .find((g) => g.name === groupName)
        .items.includes(`room:${created.roomId}`),
    );
    await page
      .locator(`[data-public-channel-id="${created.roomId}"]`)
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
    await page
      .locator(
        `[data-sidebar-section^="custom:"] [data-public-channel-id="${created.roomId}"]`,
      )
      .waitFor();
    await page.getByRole("button", { name: "排序 频道", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "按名称排序", exact: true })
      .click();
    await page.reload();
    assert.equal(
      (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences.channelSortMode,
      "az",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );

    // A second client's change must reject the stale patch, never overwrite it.
    await page.getByRole("button", { name: "排序 频道", exact: true }).click();
    const fresh = (
      await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      })
    ).preferences;
    await client.request("sidebar.patch", {
      workspaceId: workspace.workspaceId,
      expectedVersion: fresh.version,
      idempotencyKey: crypto.randomUUID(),
      patch: { channelSortMode: "recent" },
    });
    await page
      .getByRole("menuitem", { name: "按名称排序", exact: true })
      .click();
    await page
      .getByText("操作未成功，已刷新列表设置；请检查后重新操作。", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences.channelSortMode,
      "recent",
    );
    await page
      .getByRole("button", { name: groupName, exact: true })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "重命名分组", exact: true })
      .click();
    await dialog
      .getByLabel("名称", { exact: true })
      .fill(`${groupName}Renamed`);
    await dialog.getByRole("button", { name: "保存分组", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "排序 频道", exact: true }).click();
    await page.getByRole("menuitem", { name: "手动排序", exact: true }).click();
    // Drag section headings and channel rows using actual pointer sensors.
    const drag = async (from, to) => {
      await page
        .getByText("正在处理…", { exact: true })
        .waitFor({ state: "hidden" });
      await page.waitForFunction(
        (el) =>
          el.closest("[aria-disabled]")?.getAttribute("aria-disabled") !==
          "true",
        await from.elementHandle(),
      );
      await to.hover();
      await from.hover();
      const a = await from.boundingBox(),
        b = await to.boundingBox();
      await page.mouse.move(
        a.x + Math.min(30, a.width / 2),
        a.y + a.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(b.x + Math.min(30, b.width / 2), b.y + 2, {
        steps: 15,
      });
      await page.mouse.up();
    };
    const customId = `custom:${(await client.request("sidebar.get", { workspaceId: workspace.workspaceId })).preferences.customSections.find((g) => g.name === `${groupName}Renamed`).id}`;
    await drag(
      page.getByRole("button", { name: `${groupName}Renamed`, exact: true }),
      page.locator('[data-sidebar-section="channels"] [data-section-handle]'),
    );
    await page.waitForFunction((id) => {
      const sections = [
        ...document.querySelectorAll("[data-sidebar-section]"),
      ].map((e) => e.dataset.sidebarSection);
      return sections.indexOf(id) < sections.indexOf("channels");
    }, customId);
    await drag(
      page.locator(`[data-channel-row="${created.roomId}"]`),
      page.locator('[data-sidebar-section="channels"] [data-section-handle]'),
    );
    await page
      .locator(
        `[data-sidebar-section="channels"] [data-channel-row="${created.roomId}"]`,
      )
      .waitFor();
    await drag(
      page.locator(`[data-channel-row="${created.roomId}"]`),
      page.locator(
        `[data-sidebar-section="${customId}"] [data-section-handle]`,
      ),
    );
    await page
      .locator(
        `[data-sidebar-section="${customId}"] [data-channel-row="${created.roomId}"]`,
      )
      .waitFor();
    await page
      .getByRole("button", {
        name: `${groupName}Renamed`,
        exact: true,
      })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除分组", exact: true }).click();
    await dialog
      .getByRole("button", { name: "确认删除分组", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await page
      .locator(
        `[data-sidebar-section="channels"] [data-public-channel-id="${created.roomId}"]`,
      )
      .waitFor();
    await page.reload();
    await page
      .locator(
        `[data-sidebar-section="channels"] [data-public-channel-id="${created.roomId}"]`,
      )
      .waitFor();
    assert.equal(
      (
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms.filter((r) => r.roomId === created.roomId).length,
      1,
    );
    const channelRows = page.locator(
      '[data-sidebar-section="channels"] [data-channel-row]',
    );
    const before = await channelRows.evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-channel-row")),
    );
    assert.ok(before.length >= 3);
    const source = await channelRows.nth(2).boundingBox();
    const target = await channelRows.nth(1).boundingBox();
    await page.mouse.move(source.x + 30, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 30, target.y + 2, { steps: 15 });
    await page.mouse.up();
    const expected = [...before];
    [expected[1], expected[2]] = [expected[2], expected[1]];
    await page.waitForFunction(
      (ids) =>
        JSON.stringify(
          [
            ...document.querySelectorAll(
              '[data-sidebar-section="channels"] [data-channel-row]',
            ),
          ].map((r) => r.getAttribute("data-channel-row")),
        ) === JSON.stringify(ids),
      expected,
    );
    await page.reload();
    await page.waitForFunction(
      (ids) =>
        JSON.stringify(
          [
            ...document.querySelectorAll(
              '[data-sidebar-section="channels"] [data-channel-row]',
            ),
          ].map((r) => r.getAttribute("data-channel-row")),
        ) === JSON.stringify(ids),
      expected,
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      roleCreateUnknownReplay: true,
      roleEditAndStableId: true,
      instanceCreateRestartRemove: true,
      frozenRevisionAndExplicitAdoption: true,
      privateOpenRecoveryFromAgentPage: true,
      roleDeletePreservesInstance: true,
      channelCreateGroupPinSortAndReload: true,
      sidebarUnknownReplayAndConcurrentConflict: true,
      groupRenameDeleteKeepsChannel: true,
      manualRowAndSectionOrder: true,
      sidebarIconsContextKeyboardTouchAndDismissal: true,
    });
    await context.close();
  }
  return results;
}
